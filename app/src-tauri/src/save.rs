//! The save file: one JSON document in the app-data folder.
//!
//! Guarantees, in order of importance:
//!
//! 1. `save.json` is always either the previous complete save or the new
//!    complete save. It is replaced by a single rename, never written in place,
//!    so killing the process at any instant cannot leave half a file there.
//! 2. `save.bak.json` is the last save that was known to be good before the
//!    current one. It is only ever replaced by a complete, valid file.
//! 3. `load` returns the main file if it parses, otherwise the backup, and says
//!    which one it used.
//!
//! The shell does not interpret the document. It only insists that what it
//! writes and what it returns is valid JSON; versions and migrations belong to
//! the pet brain.
//!
//! Pure file-system code: no Tauri and no Win32, so the tests run anywhere.

use serde::Serialize;
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const MAIN: &str = "save.json";
pub const BACKUP: &str = "save.bak.json";

/// Serialises writers inside this process. Two instances of the app are kept
/// apart by per-process temporary file names.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Loaded {
  /// The saved document, or `null` when there is nothing usable.
  pub data: Option<String>,
  /// `"main"`, `"backup"` or `"none"`.
  pub source: &'static str,
  /// Why the main file was not used, when it was not.
  pub problem: Option<String>,
}

fn is_json(text: &str) -> bool {
  !text.trim().is_empty() && serde_json::from_str::<serde::de::IgnoredAny>(text).is_ok()
}

/// Read `path` and return its text if it is a complete JSON document.
fn read_valid(path: &Path) -> Result<String, String> {
  match fs::read(path) {
    Err(e) if e.kind() == io::ErrorKind::NotFound => Err("missing".into()),
    Err(e) => Err(format!("unreadable: {e}")),
    Ok(bytes) => match String::from_utf8(bytes) {
      Err(_) => Err("not UTF-8".into()),
      Ok(text) if is_json(&text) => Ok(text),
      Ok(_) => Err("not valid JSON".into()),
    },
  }
}

pub fn load(dir: &Path) -> Loaded {
  match read_valid(&dir.join(MAIN)) {
    Ok(data) => Loaded { data: Some(data), source: "main", problem: None },
    Err(main_problem) => match read_valid(&dir.join(BACKUP)) {
      Ok(data) => Loaded { data: Some(data), source: "backup", problem: Some(format!("save.json is {main_problem}")) },
      Err(backup_problem) => {
        let nothing_there = main_problem == "missing" && backup_problem == "missing";
        Loaded {
          data: None,
          source: "none",
          problem: if nothing_there {
            None
          } else {
            Some(format!("save.json is {main_problem}; save.bak.json is {backup_problem}"))
          },
        }
      }
    },
  }
}

fn temp_path(dir: &Path, stem: &str) -> PathBuf {
  dir.join(format!("{stem}.{}.tmp", std::process::id()))
}

/// Write `bytes` to a new file and make sure they are on the disk before returning.
fn write_durably(path: &Path, bytes: &[u8]) -> io::Result<()> {
  let mut file = File::create(path)?;
  file.write_all(bytes)?;
  file.sync_all()
}

pub fn save(dir: &Path, json: &str) -> Result<(), String> {
  if !is_json(json) {
    return Err("refusing to save: not valid JSON".into());
  }
  let _guard = WRITE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
  save_locked(dir, json).map_err(|e| format!("save failed: {e}"))
}

fn save_locked(dir: &Path, json: &str) -> io::Result<()> {
  fs::create_dir_all(dir)?;
  let main = dir.join(MAIN);
  let backup = dir.join(BACKUP);
  let new_main = temp_path(dir, MAIN);
  let new_backup = temp_path(dir, BACKUP);

  // 1. The new save, complete and flushed, under a temporary name.
  write_durably(&new_main, json.as_bytes())?;

  // 2. Keep the current save as the backup, but only if it is good. A corrupt
  //    main file must never overwrite a good backup.
  if let Ok(current) = read_valid(&main) {
    write_durably(&new_backup, current.as_bytes())?;
    fs::rename(&new_backup, &backup)?;
  }

  // 3. Swap the new save in. One rename: the old file or the new one, never a mixture.
  fs::rename(&new_main, &main)
}

/// Remove temporary files left behind by a process that was killed mid-save.
/// Only files from processes that are not this one are touched.
pub fn sweep_temp_files(dir: &Path) {
  let Ok(entries) = fs::read_dir(dir) else { return };
  let mine = format!(".{}.tmp", std::process::id());
  for entry in entries.flatten() {
    let name = entry.file_name().to_string_lossy().into_owned();
    let is_ours = name.starts_with(MAIN) || name.starts_with(BACKUP);
    if is_ours && name.ends_with(".tmp") && !name.ends_with(&mine) {
      let _ = fs::remove_file(entry.path());
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::io::{BufRead, BufReader};
  use std::process::{Command, Stdio};
  use std::time::{Duration, Instant};

  /// A fresh, empty directory under the system temp folder, removed again when the test
  /// is over (passed or failed), so that a run leaves nothing behind.
  struct Scratch(PathBuf);

  impl std::ops::Deref for Scratch {
    type Target = Path;
    fn deref(&self) -> &Path {
      &self.0
    }
  }

  impl Drop for Scratch {
    fn drop(&mut self) {
      let _ = fs::remove_dir_all(&self.0);
    }
  }

  fn scratch(name: &str) -> Scratch {
    let dir = std::env::temp_dir().join(format!("doozer-save-test-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    Scratch(dir)
  }

  #[test]
  fn nothing_saved_yet() {
    let dir = scratch("empty");
    assert_eq!(load(&dir), Loaded { data: None, source: "none", problem: None });
  }

  #[test]
  fn a_missing_folder_is_created_on_save_and_tolerated_on_load() {
    let root = scratch("nested");
    let dir = root.join("a").join("b");
    assert_eq!(load(&dir).source, "none");
    save(&dir, r#"{"v":1}"#).unwrap();
    assert_eq!(load(&dir).data.as_deref(), Some(r#"{"v":1}"#));
  }

  #[test]
  fn round_trip_and_backup_rotation() {
    let dir = scratch("rotate");
    save(&dir, r#"{"n":1}"#).unwrap();
    assert!(!dir.join(BACKUP).exists(), "the first save has nothing to back up");
    save(&dir, r#"{"n":2}"#).unwrap();
    save(&dir, r#"{"n":3}"#).unwrap();
    assert_eq!(load(&dir), Loaded { data: Some(r#"{"n":3}"#.into()), source: "main", problem: None });
    assert_eq!(fs::read_to_string(dir.join(BACKUP)).unwrap(), r#"{"n":2}"#);
  }

  #[test]
  fn invalid_json_is_refused_and_changes_nothing() {
    let dir = scratch("refuse");
    save(&dir, r#"{"n":1}"#).unwrap();
    assert!(save(&dir, r#"{"n":"#).is_err());
    assert!(save(&dir, "").is_err());
    assert!(save(&dir, "   ").is_err());
    assert_eq!(load(&dir).data.as_deref(), Some(r#"{"n":1}"#));
    assert!(!dir.join(BACKUP).exists());
  }

  #[test]
  fn a_truncated_main_file_falls_back_to_the_backup() {
    let dir = scratch("truncated");
    save(&dir, r#"{"n":1}"#).unwrap();
    save(&dir, r#"{"n":2}"#).unwrap();
    fs::write(dir.join(MAIN), r#"{"n":"#).unwrap();
    let loaded = load(&dir);
    assert_eq!(loaded.source, "backup");
    assert_eq!(loaded.data.as_deref(), Some(r#"{"n":1}"#));
    assert_eq!(loaded.problem.as_deref(), Some("save.json is not valid JSON"));
  }

  #[test]
  fn an_empty_or_binary_main_file_falls_back_to_the_backup() {
    let dir = scratch("garbage");
    save(&dir, r#"{"n":1}"#).unwrap();
    save(&dir, r#"{"n":2}"#).unwrap();
    fs::write(dir.join(MAIN), b"").unwrap();
    assert_eq!(load(&dir).source, "backup");
    fs::write(dir.join(MAIN), [0xff, 0xfe, 0x00, 0x80]).unwrap();
    assert_eq!(load(&dir).source, "backup");
  }

  #[test]
  fn a_corrupt_main_file_never_overwrites_a_good_backup() {
    let dir = scratch("protect-backup");
    save(&dir, r#"{"n":1}"#).unwrap();
    save(&dir, r#"{"n":2}"#).unwrap();
    fs::write(dir.join(MAIN), "garbage").unwrap();
    save(&dir, r#"{"n":3}"#).unwrap();
    assert_eq!(load(&dir).data.as_deref(), Some(r#"{"n":3}"#));
    assert_eq!(fs::read_to_string(dir.join(BACKUP)).unwrap(), r#"{"n":1}"#, "backup must still be the last good save");
  }

  #[test]
  fn both_files_corrupt_reports_why() {
    let dir = scratch("both-bad");
    fs::write(dir.join(MAIN), "{").unwrap();
    fs::write(dir.join(BACKUP), "[").unwrap();
    let loaded = load(&dir);
    assert_eq!(loaded.source, "none");
    assert_eq!(loaded.data, None);
    assert!(loaded.problem.unwrap().contains("save.bak.json is not valid JSON"));
  }

  #[test]
  fn stale_temp_files_from_other_processes_are_swept() {
    let dir = scratch("sweep");
    save(&dir, r#"{"n":1}"#).unwrap();
    let stale = dir.join("save.json.999999.tmp");
    let unrelated = dir.join("notes.tmp");
    fs::write(&stale, "{").unwrap();
    fs::write(&unrelated, "keep").unwrap();
    sweep_temp_files(&dir);
    assert!(!stale.exists());
    assert!(unrelated.exists());
    assert_eq!(load(&dir).data.as_deref(), Some(r#"{"n":1}"#));
  }

  // ---- Killed mid-write -------------------------------------------------------
  //
  // `kill_mid_write` starts this same test binary as a child process running
  // `torture_writer`, which saves ever-newer generations as fast as it can. The
  // parent kills it at a random moment, many times over, and after every kill
  // checks that what is on disk is complete, valid, and at least as new as the
  // last save the child reported as finished.

  const TORTURE_DIR: &str = "DOOZER_SAVE_TORTURE_DIR";
  const TORTURE_BYTES: &str = "DOOZER_SAVE_TORTURE_BYTES";

  fn torture_doc(generation: u64, fill_bytes: usize) -> String {
    // The filler makes the write take long enough to be interrupted, and its
    // content depends on the generation so a mixture of two saves cannot pass
    // for a consistent document.
    let digit = b'a' + (generation % 26) as u8;
    let fill = String::from_utf8(vec![digit; fill_bytes]).unwrap();
    format!(r#"{{"gen":{generation},"len":{fill_bytes},"fill":"{fill}","end":{generation}}}"#)
  }

  /// The generation number at the head of a torture document, without checking the rest.
  fn head_generation(text: &str) -> Option<u64> {
    let rest = text.strip_prefix(r#"{"gen":"#)?;
    rest[..rest.find(',')?].parse().ok()
  }

  /// Parse a torture document and return its generation, or explain what is wrong with it.
  fn check_torture_doc(text: &str) -> Result<u64, String> {
    let v: serde_json::Value = serde_json::from_str(text).map_err(|e| format!("does not parse: {e}"))?;
    let generation = v["gen"].as_u64().ok_or("no gen")?;
    let len = v["len"].as_u64().ok_or("no len")? as usize;
    let fill = v["fill"].as_str().ok_or("no fill")?;
    let digit = char::from(b'a' + (generation % 26) as u8);
    if fill.len() != len {
      return Err(format!("fill is {} bytes, expected {len}", fill.len()));
    }
    if !fill.chars().all(|c| c == digit) {
      return Err("fill is a mixture of generations".into());
    }
    if v["end"].as_u64() != Some(generation) {
      return Err("tail does not match head".into());
    }
    Ok(generation)
  }

  /// Child-process half of `kill_mid_write`. Does nothing unless the parent set it up.
  #[test]
  #[ignore = "helper process for kill_mid_write"]
  fn torture_writer() {
    let Ok(dir) = std::env::var(TORTURE_DIR) else { return };
    let dir = PathBuf::from(dir);
    let bytes: usize = std::env::var(TORTURE_BYTES).ok().and_then(|s| s.parse().ok()).unwrap_or(1024);
    let mut generation = load(&dir).data.and_then(|d| head_generation(&d)).unwrap_or(0);
    let stdout = io::stdout();
    loop {
      generation += 1;
      save(&dir, &torture_doc(generation, bytes)).unwrap();
      let mut out = stdout.lock();
      writeln!(out, "saved {generation}").unwrap();
      out.flush().unwrap();
    }
  }

  /// The generation a line of the writer's output reports as saved, if it reports one.
  ///
  /// The report is looked for anywhere in the line, not only at its start. The test
  /// harness the writer runs under prints "test save::tests::torture_writer ... " with no
  /// line break before the test begins, so the writer's first report arrives as
  /// "test save::tests::torture_writer ... saved 236". Reading only lines that *begin*
  /// with "saved " lost the first report of every writer. It went unnoticed for as long
  /// as the second report followed; but a writer killed just after its second save had
  /// swapped in, and before it could say so, then left the file two generations ahead of
  /// the last report the parent had seen, and the parent called that a jump. It happened
  /// about once in forty runs on a busy disk, and the save was never at fault.
  fn reported_generation(line: &str) -> Option<u64> {
    let (_, tail) = line.rsplit_once("saved ")?;
    let digits: String = tail.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
  }

  #[test]
  fn every_report_of_the_writer_is_read_wherever_it_is_on_the_line() {
    assert_eq!(reported_generation("saved 12"), Some(12));
    assert_eq!(reported_generation("saved 12\r"), Some(12));
    // The first report of every writer shares its line with the harness's own words.
    assert_eq!(reported_generation("test save::tests::torture_writer ... saved 236"), Some(236));
    // A writer killed between a report and its line break leaves the report whole.
    assert_eq!(reported_generation("saved 7"), Some(7));
    assert_eq!(reported_generation("running 1 test"), None);
    assert_eq!(reported_generation("test save::tests::torture_writer ... "), None);
    assert_eq!(reported_generation("saved "), None);
    assert_eq!(reported_generation(""), None);
  }

  /// Start the writer child, plus a thread that forwards each "saved N" report with its arrival time.
  fn spawn_writer(
    dir: &Path,
    fill_bytes: usize,
  ) -> (std::process::Child, std::sync::mpsc::Receiver<(u64, Instant)>, std::thread::JoinHandle<()>) {
    let mut child = Command::new(std::env::current_exe().unwrap())
      .args(["--exact", "save::tests::torture_writer", "--ignored", "--nocapture", "--test-threads=1"])
      .env(TORTURE_DIR, dir)
      .env(TORTURE_BYTES, fill_bytes.to_string())
      .stdout(Stdio::piped())
      .stderr(Stdio::null())
      .spawn()
      .unwrap();
    let stdout = child.stdout.take().unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    let reader = std::thread::spawn(move || {
      for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        if let Some(n) = reported_generation(&line) {
          let _ = tx.send((n, Instant::now()));
        }
      }
    });
    (child, rx, reader)
  }

  fn temp_files(dir: &Path) -> usize {
    fs::read_dir(dir).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().ends_with(".tmp")).count()
  }

  fn run_kill_rounds(name: &str, fill_bytes: usize, rounds: u32) {
    let dir = scratch(name);
    let mut seed = 0x9e37_79b9_7f4a_7c15_u64 ^ fill_bytes as u64;
    let mut highest_confirmed = 0u64;

    // Calibrate: how long does one save take on this machine? The kills are then
    // spread evenly over a little more than one full cycle, so every step of a
    // save gets hit.
    let (mut child, rx, reader) = spawn_writer(&dir, fill_bytes);
    let mut stamps = Vec::new();
    while stamps.len() < 6 {
      let (n, at) = rx.recv_timeout(Duration::from_secs(60)).expect("the writer never completed a save");
      highest_confirmed = n;
      stamps.push(at);
    }
    child.kill().unwrap();
    child.wait().unwrap();
    reader.join().unwrap();
    while let Ok((n, _)) = rx.try_recv() {
      highest_confirmed = highest_confirmed.max(n);
    }
    // The calibration kill is a kill like any other: the file may be one ahead.
    if let Some(n) = load(&dir).data.as_deref().and_then(|d| check_torture_doc(d).ok()) {
      highest_confirmed = highest_confirmed.max(n);
    }
    let cycle = (*stamps.last().unwrap() - stamps[0]) / (stamps.len() as u32 - 1);
    let spread_micros = (cycle.as_micros() as u64 * 5 / 4).max(2_000);

    // Evidence that kills really landed inside a save.
    let mut during_write = 0u32; // a temporary file was left half-way
    let mut between_backup_and_swap = 0u32; // backup already rotated, new save not yet swapped in
    let mut between_swap_and_report = 0u32; // new save swapped in, the child had not said so yet
    let mut before_first_save = 0u32;

    for round in 0..rounds {
      let temp_before = temp_files(&dir);
      let (mut child, rx, reader) = spawn_writer(&dir, fill_bytes);
      seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
      let extra = Duration::from_micros((seed >> 33) % spread_micros);
      let mut confirmed_this_round = None;
      // Every fourth round, do not wait for a save at all: kill during start-up or the first write.
      if round % 4 != 0 {
        let (n, _) = rx
          .recv_timeout(Duration::from_secs(60))
          .unwrap_or_else(|_| panic!("round {round}: the writer never completed a save"));
        confirmed_this_round = Some(n);
      }
      std::thread::sleep(extra);
      child.kill().unwrap();
      child.wait().unwrap();
      reader.join().unwrap();
      while let Ok((n, _)) = rx.try_recv() {
        confirmed_this_round = Some(n);
      }
      match confirmed_this_round {
        Some(n) => highest_confirmed = highest_confirmed.max(n),
        None => before_first_save += 1,
      }
      if temp_files(&dir) > temp_before {
        during_write += 1;
      }

      // What survived?
      let loaded = load(&dir);
      assert_eq!(loaded.source, "main", "round {round}: fell back to {:?} ({:?})", loaded.source, loaded.problem);
      let on_disk = check_torture_doc(loaded.data.as_deref().unwrap())
        .unwrap_or_else(|e| panic!("round {round}: save.json is damaged: {e}"));
      assert!(
        on_disk >= highest_confirmed,
        "round {round}: save.json is generation {on_disk} but generation {highest_confirmed} was reported as saved"
      );
      assert!(
        on_disk <= highest_confirmed + 1,
        "round {round}: save.json jumped from {highest_confirmed} to {on_disk}"
      );
      if on_disk > highest_confirmed {
        between_swap_and_report += 1;
        highest_confirmed = on_disk;
      }
      let backup = fs::read_to_string(dir.join(BACKUP)).unwrap();
      let backup_generation =
        check_torture_doc(&backup).unwrap_or_else(|e| panic!("round {round}: save.bak.json is damaged: {e}"));
      // The backup is the save before the current one or, for the instant
      // between rotating the backup and swapping in the new save, the same one.
      assert!(
        backup_generation == on_disk || backup_generation + 1 == on_disk,
        "round {round}: backup is generation {backup_generation}, main is {on_disk}"
      );
      if backup_generation == on_disk {
        between_backup_and_swap += 1;
      }
    }

    println!(
      "kill_mid_write[{name}]: {rounds} kills of a writer saving {fill_bytes} bytes (one save takes about {cycle:?}); \
       generation reached {highest_confirmed}; kills that landed: {during_write} while a file was being written, \
       {between_backup_and_swap} between backup rotation and the swap, {between_swap_and_report} just after the swap, \
       {before_first_save} before the round's first save; save.json and save.bak.json were complete after every kill"
    );
    assert!(during_write > 0, "no kill landed while a file was being written; the test proved nothing");
    sweep_temp_files(&dir);
    assert_eq!(temp_files(&dir), 0);
  }

  #[test]
  fn kill_mid_write_small_payload() {
    // About the size of a real save.
    run_kill_rounds("kill-small", 4 * 1024, 150);
  }

  #[test]
  fn kill_mid_write_large_payload() {
    // Far larger than a real save, so most kills land while bytes are being written.
    run_kill_rounds("kill-large", 8 * 1024 * 1024, 80);
  }
}
