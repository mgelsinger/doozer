//! Doozer's native shell. One transparent window, one page (WORK_PLAN.md, section 3).

pub fn run() {
  tauri::Builder::default()
    .run(tauri::generate_context!())
    .expect("error while running Doozer");
}
