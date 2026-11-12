# A week with Doozer: simulation and tuning notes

Phase 4 (pet brain), 2026-11-11. This is the output of the headless week simulation and the reasoning behind the numbers in [`app/src/core/tuning.ts`](../app/src/core/tuning.ts).

**The targets** (WORK_PLAN.md, Phase 4, task 10): three to five short visits a day should keep Doozer happy; a missed day should leave it sulky but recoverable in one visit.

**The result:** both are met, after slowing all four drain rates from the first guesses in the spec. With three to five visits a day Doozer's tummy, fun and clean are all above "low" for 95–100% of the week; after a missed day it greets you hungry or bored with an average need in the 30s or 40s, and one ordinary visit puts it right. Two things are worth the owner's attention and are set out under [Things to know](#things-to-know): Doozer spends about a fifth of its time *sleepy* whatever you do, and the bowl is doing most of the work.

---

## What was simulated

The real brain (`createBrain`), a fake clock, and a visitor who behaves like a caring person with about a minute to spare.

- **The week** starts Monday 08:00 with a newly hatched Doozer and runs seven days. Visits are spread evenly from 08:00 to 22:00 (three a day: 08:00, 15:00, 22:00), so every night is a ten-hour gap.
- **Between visits the app is closed.** Each visit restores from the save, which runs the offline catch-up (capped at 12 hours). Leaving the app running instead gives exactly the same curves; a test checks that.
- **A short visit:** fill the bowl; hand-feed if tummy is 62 or less; wash if clean is under 75; play until fun is over 80, unless energy is under 20; one treat if fun is still 80 or less; two strokes (up to eight if Doozer is bored and too tired to play); top the bowl up; tuck Doozer in if energy is under 30. If Doozer is asleep and neither rested nor in need, it is left asleep with a stroke and a full bowl.
- **Real people are not punctual,** so the pass/fail checks also run every schedule with each visit up to 45 minutes early or late, over several different weeks.

Run it yourself from `app/`:

```
node tests/core/week-sim.run.mjs                         comparison table, 5 down to 0 visits a day
node tests/core/week-sim.run.mjs --visits 4 --skip 4     curves for one scenario (here: day 4 missed)
node tests/core/week-sim.run.mjs --jitter 45 --weeks 3   visits early or late, three different weeks each
```

Options: `--visits N  --days N  --skip D[,D]  --focus N  --no-bowl  --open  --jitter MIN  --seed N  --weeks N`. The same simulation backs the assertions in `app/tests/core/week-sim.test.ts`, so a change to the numbers that breaks a target fails `npm test`.

---

## The numbers

| | Spec's first guess | Tuned | Why |
|---|---|---|---|
| Tummy drain, per awake hour | 22 | **14** | A full tummy plus a full bowl is 190 points (each serving is eaten at 70 and tops out at 100, so it is worth 30, not 32). At 22 that lasts under nine hours: hungry every single morning. At 14 it lasts 13½ hours: fine after a ten-hour night, hungry after a missed day. |
| Fun drain | 26 | **6** | Nothing restores fun while you are away. At 26 a full Fun is gone in under four hours, so Doozer is bored at every visit and sits at zero all night. At 6 it comes through a night at about 45 and through a missed day at about 30. |
| Energy drain | 11 | **8** | At 11 one wake-and-nap cycle is about 10 hours, the same as the night, so Doozer kept reaching the morning visit at energy 5–7: too tired to play, which meant fun could not be fixed either. At 9 the cycle matches the 12-hour catch-up cap and the same thing happens after every missed day. 8 avoids both. |
| Clean drain | 8 | **4.5** | At 8 Doozer is grubby nine hours after a bath, so every morning. At 4.5 a bath lasts about 15 hours: one wash a day. |
| Energy while asleep | +60 | +60 | A nap from empty takes about an hour and a half. |
| Other needs while asleep | "a fraction" | tummy ×0.5, fun ×0.15, clean ×0.5 | As in the mockup. |
| Meal / treat / play / stroke | +32 · +10 and +16 · +28 (−7 energy, −4 tummy) · +3 | unchanged | |
| Low / urgent | 30 / 12 | unchanged | |
| Falls asleep / wakes | 4 / 100 | unchanged | |
| Bowl | 3 servings, eats below 70 | unchanged, plus a **five-minute pause** between servings | New. Without it a very hungry Doozer empties the bowl in one instant, and a view would have three eating scenes to play at once. |
| Bond (hidden) | +2 an hour when well, −5 an hour when a need is urgent | **+0.1** and **−1** an hour; small gains per interaction | The mockup's rate filled the bond in two days. "Rises slowly" now means two to three weeks of good care. |

The spec says these are "starting values to tune in the brain phase", so no amendment to its rules is needed, but **the table in DESIGN_SPEC.md section 3.1 still shows the first guesses.** I have not edited the spec (it is not my file and had uncommitted changes from another session). Suggested amendment for section 13: "Drain rates tuned in Phase 4 to 14 / 6 / 8 / 4.5 per hour; see docs/brain-week-sim.md."

---

## Results

### Visits on the dot

```
scenario                                                               | fine | joyful content  meh | hungry bored sleepy dirty | asleep | avg  | urgent h (T/F/E/C)  | lowest (T/F/E/C) | bond
-----------------------------------------------------------------------|------|---------------------|---------------------------|--------|------|---------------------|------------------|----------
5 visits a day, app closed between visits                              |  84% |    38%     32%   1% |     0%    1%    14%    0% |    13% |   75 |     0.0/0.0/4.4/0.0 |       19/23/4/43 | 12 -> 41
4 visits a day, app closed between visits                              |  81% |    30%     38%   2% |     0%    0%    18%    0% |    13% |   72 |     0.0/0.0/8.5/0.0 |       37/38/4/38 | 12 -> 35
3 visits a day, app closed between visits                              |  72% |    23%     37%   0% |     0%    2%    26%    0% |    13% |   70 |    0.0/0.0/12.3/0.0 |       24/19/4/41 | 12 -> 30
2 visits a day, app closed between visits                              |  49% |    14%     24%   3% |     7%   32%     9%    0% |    12% |   58 |   12.4/37.0/4.1/0.0 |         0/0/4/38 | 12 -> 5
1 visit a day, app closed between visits                               |  32% |     9%     15%   0% |    53%    0%    15%    0% |     7% |   53 |    69.0/0.0/8.5/0.0 |        0/25/4/46 | 12 -> 12
0 visits a day, app closed between visits                              |   5% |     1%      3%  93% |     0%    0%     2%    0% |     1% |   49 |     0.0/0.0/1.0/0.0 |       33/34/4/38 | 12 -> 13
```

How to read it: **fine** is the share of the week Doozer was joyful, content or asleep. The next three groups split the week by mood. **urgent h** is hours in the week with that need below 12 (Tummy / Fun / Energy / Clean); **lowest** is the lowest each need reached. **bond** is the hidden value at the start and end of the week.

### Visits up to 45 minutes early or late, three different weeks each

```
scenario                                                               | fine | joyful content  meh | hungry bored sleepy dirty | asleep | avg  | urgent h (T/F/E/C)  | lowest (T/F/E/C) | bond
-----------------------------------------------------------------------|------|---------------------|---------------------------|--------|------|---------------------|------------------|----------
5 visits a day, up to 45 min early or late, app closed between visits  |  83% |    36%     33%   1% |     0%    1%    16%    0% |    14% |   74 |     0.0/0.0/5.9/0.0 |       23/22/4/39 | 12 -> 40
5 visits a day, up to 45 min early or late, app closed between visits  |  82% |    34%     34%   1% |     0%    0%    17%    0% |    14% |   73 |     0.0/0.0/5.2/0.0 |       31/32/4/42 | 12 -> 40
5 visits a day, up to 45 min early or late, app closed between visits  |  78% |    31%     34%   0% |     0%    0%    22%    0% |    13% |   73 |     0.0/0.0/9.1/0.0 |       45/38/4/35 | 12 -> 36
4 visits a day, up to 45 min early or late, app closed between visits  |  79% |    28%     37%   2% |     0%    0%    19%    0% |    13% |   72 |     0.0/0.0/8.3/0.0 |       44/26/4/38 | 12 -> 35
4 visits a day, up to 45 min early or late, app closed between visits  |  86% |    35%     36%   2% |     0%    0%    12%    0% |    14% |   74 |     0.0/0.0/6.3/0.0 |       36/42/4/37 | 12 -> 39
4 visits a day, up to 45 min early or late, app closed between visits  |  79% |    28%     37%   2% |     0%    0%    19%    0% |    14% |   72 |     0.0/0.0/9.2/0.0 |       29/37/4/33 | 12 -> 35
3 visits a day, up to 45 min early or late, app closed between visits  |  72% |    23%     36%   0% |     0%    3%    24%    0% |    13% |   70 |    0.0/0.0/12.2/0.0 |       28/15/4/31 | 12 -> 31
3 visits a day, up to 45 min early or late, app closed between visits  |  73% |    22%     38%   0% |     0%    4%    23%    0% |    13% |   70 |    0.0/0.4/11.0/0.0 |        24/9/4/27 | 12 -> 31
3 visits a day, up to 45 min early or late, app closed between visits  |  73% |    24%     36%   0% |     0%    2%    25%    0% |    13% |   71 |    0.0/0.3/12.8/0.0 |       35/10/4/33 | 12 -> 30
2 visits a day, up to 45 min early or late, app closed between visits  |  49% |    13%     24%   2% |    12%   26%    11%    0% |    12% |   57 |   15.6/32.3/6.3/3.3 |          0/0/4/7 | 12 -> 6
2 visits a day, up to 45 min early or late, app closed between visits  |  47% |    13%     22%   2% |    11%   29%    11%    0% |    12% |   57 |   14.5/36.2/6.3/2.8 |          0/0/4/6 | 12 -> 2
2 visits a day, up to 45 min early or late, app closed between visits  |  54% |    16%     27%   3% |     7%   24%    11%    0% |    12% |   60 |   10.3/23.3/4.3/0.0 |         0/0/4/38 | 12 -> 12
1 visit a day, up to 45 min early or late, app closed between visits   |  32% |     5%     20%   1% |    53%    0%    15%    0% |     7% |   51 |    56.4/0.0/8.5/0.0 |        0/25/4/47 | 12 -> 14
1 visit a day, up to 45 min early or late, app closed between visits   |  32% |     8%     16%   0% |    53%    0%    15%    0% |     7% |   52 |    68.8/0.0/8.2/0.0 |        0/25/4/46 | 12 -> 12
1 visit a day, up to 45 min early or late, app closed between visits   |  32% |     6%     19%   0% |    53%    0%    15%    0% |     7% |   52 |    69.2/0.0/8.2/0.0 |        0/25/4/47 | 12 -> 13
0 visits a day, up to 45 min early or late, app closed between visits  |   5% |     1%      3%  93% |     0%    0%     2%    0% |     1% |   49 |     0.0/0.0/1.0/0.0 |       33/34/4/38 | 12 -> 13
0 visits a day, up to 45 min early or late, app closed between visits  |   5% |     1%      3%  93% |     0%    0%     2%    0% |     1% |   49 |     0.0/0.0/1.0/0.0 |       33/34/4/38 | 12 -> 13
0 visits a day, up to 45 min early or late, app closed between visits  |   5% |     1%      3%  93% |     0%    0%     2%    0% |     1% |   49 |     0.0/0.0/1.0/0.0 |       33/34/4/38 | 12 -> 13
```

### What the checks in `week-sim.test.ts` hold it to

Over eight different weeks per schedule, visits up to 45 minutes off:

| Visits a day | Tummy, fun and clean all above "low" | Arrivals that find one of them low | Of which mornings | Time spent sleepy |
|---|---|---|---|---|
| 5 | 98–100% of the week | 8 of 287 | 5 of 53 | 19% |
| 4 | 97–100% | 3 of 228 | 3 of 50 | 17% |
| 3 | 95–99% | 32 of 172 | 11 of 50 | 23% |
| 2 | 53–74% | 93 of 115 | 43 of 49 | 12% |
| 1 | 43–47% | 48 of 64 | — | 15% |

Three visits is the bottom of the comfortable range: about one arrival in five finds Doozer a little bored or hungry, but rarely urgently so (at most about an hour a week with one of the three below 12, and none at four or five visits). Two visits a day is not enough.

**A missed day** (four visits a day, nobody on day 4), eight different weeks:

| Week | On arrival, 08:00 on day 5 | After that one visit |
|---|---|---|
| 1 | hungry — T 26 · F 36 · C 33 | joyful — T 82 · F 98 · C 100 |
| 2 | hungry — T 21 · F 36 · C 31 | joyful — T 77 · F 98 · C 100 |
| 3 | hungry — T 25 · F 36 · C 28 | joyful — T 81 · F 98 · C 100 |
| 4 | hungry — T 19 · F 36 · C 27 | joyful — T 75 · F 98 · C 100 |
| 5 | bored — T 29 · F 27 · C 36 | joyful — T 85 · F 89 · C 100 |
| 6 | sleepy — T 25 · F 35 · E 15 · C 24 | asleep (tucked in) — T 99 · F 60 · C 100 |
| 7 | hungry — T 27 · F 36 · C 50 | joyful — T 83 · F 98 · C 100 |
| 8 | hungry — T 16 · F 36 · C 27 | content — T 72 · F 98 · C 100 |

Week 6 is the awkward case: Doozer was also exhausted, so it could be fed and washed but not played with; a treat and some strokes got fun to 60 and it was put to bed.

### The bowl matters

```
5 visits a day, bowl never filled, app closed between visits           |  60% |    14%     33%   0% |    31%    0%     9%    0% |    13% |   64 |    36.3/0.0/5.0/0.0 |        0/33/4/43 | 12 -> 25
4 visits a day, bowl never filled, app closed between visits           |  43% |     7%     23%   0% |    49%    0%     7%    0% |    13% |   59 |    62.8/0.0/8.7/0.0 |        0/47/4/37 | 12 -> 3
3 visits a day, bowl never filled, app closed between visits           |  37% |     3%     21%   0% |    61%    0%     2%    0% |    13% |   56 |   88.8/0.0/13.0/0.0 |        0/30/4/57 | 12 -> 2
```

Same visits, bowl never filled: hungry for a third to nearly two thirds of the week. The bowl is what makes a ten-hour night survivable.

### With two 25-minute focus sessions a day

```
5 visits a day, 2 focus sessions a day, app closed between visits      |  84% |    39%     32%   0% |     0%    1%    15%    0% |    13% |   75 |     0.0/0.0/5.7/0.0 |       19/23/4/43 | 12 -> 41
4 visits a day, 2 focus sessions a day, app closed between visits      |  81% |    30%     38%   2% |     0%    0%    18%    0% |    13% |   72 |     0.0/0.0/8.5/0.0 |       37/38/4/38 | 12 -> 35
3 visits a day, 2 focus sessions a day, app closed between visits      |  73% |    21%     40%   0% |     0%    1%    26%    0% |    13% |   69 |    0.0/0.0/11.4/0.0 |       22/27/4/41 | 12 -> 31
```

Focus sessions make no difference to the needs (they are not meant to) and the treats pile up: ten sessions in the week at four visits a day, ending with 19 treats in the jar.

---

## One week in detail: four visits a day, day 4 missed

One character per half hour, each day running 08:00 to 08:00. Taller bar = fuller need.

```
Day 1 Mon 08  .   10  .   12  .   14  .   16  .   18  .   20  .   22  .   00  .   02  .   04  .   06  .
  tummy   █ █ ▇ ▇ ▆ █ █ ▇ ▆ █ █ ▇ ▇ ▆ █ █ ▇ ▇ █ ▇ ▇ ▆ █ █ ▇ ▇ █ █ ▇ ▇ ▆ █ █ ▇ ▇ ▆ █ ▇ ▇ ▆ █ █ ▇ ▇ ▆ ▅ ▅ ▄
  fun     █ █ █ █ ▇ ▇ ▇ ▇ ▆ ▆ █ █ █ █ █ █ ▇ ▇ ▇ █ █ █ █ ▇ ▇ ▇ ▇ ▇ █ █ █ █ █ █ █ ▇ ▇ ▇ ▇ ▆ ▆ ▆ ▆ ▅ ▅ ▅ ▅ ▅
  energy  ▆ ▆ ▆ ▅ ▅ ▅ ▄ ▄ ▄ ▃ ▄ ▇ █ █ █ ▇ ▇ ▇ ▇ ▆ ▅ ▅ ▅ ▄ ▄ ▄ ▃ ▃ ▂ ▅ ▇ █ █ █ ▇ ▇ ▇ ▇ ▆ ▆ ▆ ▅ ▅ ▅ ▄ ▄ ▄ ▃
  clean   █ ▇ ▇ ▇ ▇ ▇ ▇ ▆ ▆ ▆ █ █ █ █ █ █ █ ▇ ▇ ▇ ▇ ▇ ▆ ▆ ▆ ▆ ▆ ▆ █ █ █ █ █ █ █ ▇ ▇ ▇ ▇ ▇ ▇ ▆ ▆ ▆ ▆ ▆ ▅ ▅
  mood    J J J c c c c c c c z z J J J J J J J J J c c c c c c c z z z J J J J J J J c c c c c c c c c -
  visit   ^                 ^                 ^                   ^

Day 2 Tue 08  .   10  .   12  .   14  .   16  .   18  .   20  .   22  .   00  .   02  .   04  .   06  .
  tummy   ▆ ▅ ▅ ▇ ▇ ▆ █ ▇ ▇ ▆ █ ▇ ▇ ▆ █ ▇ ▇ ▆ █ ▇ ▇ ▇ ▆ █ █ ▇ ▆ █ ▇ ▇ ▆ █ █ ▇ ▆ █ █ ▇ ▇ █ █ ▇ ▇ ▆ ▆ ▆ ▅ ▅
  fun     █ █ █ █ █ █ █ ▇ ▇ ▇ █ █ █ █ ▇ ▇ ▇ ▇ ▆ █ █ █ █ █ █ █ ▇ ▇ █ █ █ █ █ ▇ ▇ ▇ ▇ ▆ ▆ ▆ ▆ ▅ ▅ ▅ ▅ ▅ ▅ ▅
  energy  ▂ ▄ ▇ █ █ █ ▇ ▇ ▇ ▇ ▆ ▅ ▅ ▅ ▄ ▄ ▄ ▃ ▃ ▃ ▅ █ █ █ █ ▇ ▇ ▇ ▆ ▅ ▅ ▅ ▅ ▄ ▄ ▄ ▃ ▃ ▃ ▂ ▂ ▂ ▁ ▁ ▂ ▄ ▇ █
  clean   █ █ █ █ █ █ █ ▇ ▇ ▇ ▇ ▇ ▇ ▆ ▆ ▆ ▆ ▆ ▆ █ █ █ █ █ █ █ ▇ ▇ ▇ ▇ ▇ ▇ ▆ ▆ ▆ ▆ ▆ ▅ ▅ ▅ ▅ ▅ ▅ ▄ ▄ ▄ ▄ ▄
  mood    z z z J J J J J J c J J c c c c c c c z z z J J J J J J J J c J c c c c c c S S S S S S z z z c
  visit   ^                 ^                 ^                   ^

Day 3 Wed 08  .   10  .   12  .   14  .   16  .   18  .   20  .   22  .   00  .   02  .   04  .   06  .
  tummy   ▆ █ █ ▇ ▆ █ █ ▇ ▇ █ █ ▇ ▆ █ █ ▇ ▇ █ █ █ ▇ ▇ ▇ █ █ ▇ ▇ █ █ ▇ ▇ █ █ ▇ ▇ █ █ ▇ ▇ ▆ █ █ ▇ ▆ ▆ ▆ ▆ ▅
  fun     █ █ █ █ █ ▇ ▇ ▇ ▇ ▆ █ █ █ █ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▆ ▆ ▆ ▆ ▅ ▅ █ ▇ ▇ ▇ ▇ ▆ ▆ ▆ ▆ ▅ ▅ ▅ ▅ ▅ ▄ ▄ ▄ ▄ ▄ ▄
  energy  ▇ ▇ ▆ ▆ ▆ ▅ ▅ ▅ ▄ ▄ ▃ ▃ ▃ ▂ ▂ ▂ ▁ ▁ ▂ ▅ ▇ █ █ █ ▇ ▇ ▇ ▇ ▆ ▅ ▅ ▅ ▄ ▄ ▄ ▃ ▃ ▃ ▂ ▂ ▂ ▁ ▁ ▁ ▃ ▆ █ █
  clean   █ █ █ █ █ █ ▇ ▇ ▇ ▇ ▇ ▇ ▆ ▆ ▆ ▆ ▆ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▄ ▄ ▄ █ █ █ █ █ █ ▇ ▇ ▇ ▇ ▇ ▇ ▆ ▆ ▆ ▆ ▆ ▆ ▆ ▅
  mood    J J J J J J J c c c c c S S S S S S z z z J c c c c c c J J c J c c c c c S S S S S S z z z z c
  visit   ^                 ^                 ^                   ^

Day 4 Thu 08  .   10  .   12  .   14  .   16  .   18  .   20  .   22  .   00  .   02  .   04  .   06  .
  tummy   ▅ ▄ ▃ ▃ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂ ▂
  fun     ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃ ▃
  energy  █ █ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇
  clean   ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅
  mood    c c c B H H H H H H H H H H H H H H H H H H H H H H H H H H H H H H H H H H H H H H H H H H H H
  visit

Day 5 Fri 08  .   10  .   12  .   14  .   16  .   18  .   20  .   22  .   00  .   02  .   04  .   06  .
  tummy   ▇ ▆ █ ▇ ▇ ▆ █ █ ▇ ▇ █ █ █ ▇ ▇ █ █ ▇ ▇ █ █ ▇ ▇ █ █ ▇ ▇ ▆ █ ▇ ▇ ▇ ▆ █ █ ▇ ▆ █ █ ▇ ▇ █ █ ▇ ▇ ▆ ▆ ▅
  fun     ▇ ▇ ▇ ▇ ▇ ▆ ▆ ▆ ▆ ▅ █ █ █ █ ▇ ▇ ▇ ▇ ▆ █ █ █ █ ▇ ▇ ▇ ▇ ▇ █ █ █ █ █ █ █ ▇ ▇ ▇ ▇ ▆ ▆ ▆ ▆ ▅ ▅ ▅ ▅ ▅
  energy  ▅ ▅ ▅ ▅ ▄ ▄ ▄ ▃ ▃ ▃ ▄ ▆ █ █ █ █ ▇ ▇ ▇ ▆ ▅ ▅ ▅ ▄ ▄ ▄ ▃ ▃ ▂ ▅ ▇ █ █ █ ▇ ▇ ▇ ▆ ▆ ▆ ▅ ▅ ▅ ▅ ▄ ▄ ▄ ▃
  clean   █ █ █ █ █ █ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▆ ▆ ▆ ▆ ▆ ▆ █ █ █ █ █ █ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▆ ▆ ▆ ▆ ▆ ▅ ▅ ▅ ▅ ▅ ▅ ▄ ▄ ▄ ▄ ▄
  mood    J c J c c c c c c S z z z J J J J c c J J J J J c c c c z z z J J J J J c J c c c c c c c c - -
  visit   ^                 ^                 ^                   ^

Day 6 Sat 08  .   10  .   12  .   14  .   16  .   18  .   20  .   22  .   00  .   02  .   04  .   06  .
  tummy   ▆ ▆ ▆ █ █ ▇ ▆ █ █ ▇ ▆ █ █ ▇ ▆ █ █ ▇ ▇ █ █ █ ▇ ▇ ▆ █ ▇ ▇ █ █ ▇ ▇ ▆ █ █ ▇ ▆ █ █ ▇ ▇ █ █ ▇ ▇ ▇ ▆ ▆
  fun     █ █ █ █ █ █ █ ▇ ▇ ▇ █ █ █ █ ▇ ▇ ▇ ▇ ▆ █ █ █ █ █ █ █ ▇ ▇ █ █ █ █ █ ▇ ▇ ▇ ▇ ▆ ▆ ▆ ▆ ▅ ▅ ▅ ▅ ▅ ▅ ▅
  energy  ▂ ▄ ▇ █ █ █ ▇ ▇ ▇ ▇ ▆ ▅ ▅ ▅ ▄ ▄ ▄ ▃ ▃ ▃ ▅ █ █ █ █ ▇ ▇ ▇ ▆ ▅ ▅ ▅ ▅ ▄ ▄ ▄ ▃ ▃ ▃ ▂ ▂ ▂ ▁ ▁ ▂ ▄ ▇ █
  clean   █ █ █ █ █ █ █ ▇ ▇ ▇ ▇ ▇ ▇ ▆ ▆ ▆ ▆ ▆ ▆ █ █ █ █ █ █ █ ▇ ▇ ▇ ▇ ▇ ▇ ▆ ▆ ▆ ▆ ▆ ▅ ▅ ▅ ▅ ▅ ▅ ▄ ▄ ▄ ▄ ▄
  mood    z z z J J J J J J J J J c c c c c c c z z z J J J J J J J J J c c c c c c c S S S S S S z z z c
  visit   ^                 ^                 ^                   ^

Day 7 Sun 08  .   10  .   12  .   14  .   16  .   18  .   20  .   22  .   00  .   02  .   04  .   06  .
  tummy   ▇ ▇ ▆ █ ▇ ▇ ▆ █ █ ▇ ▆ █ ▇ ▇ ▆ █ █ ▇ ▇ ▆ ▆ █ █ ▇ ▇ █ █ ▇ ▆ █ █ ▇ ▇ █ █ ▇ ▇ ▆ █ ▇ ▇ ▆ ▆ ▅ ▅ ▅ ▄ ▄
  fun     █ █ █ █ █ ▇ ▇ ▇ ▇ ▆ █ █ █ █ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▇ ▆ ▆ ▆ ▆ ▅ ▅ █ ▇ ▇ ▇ ▇ ▆ ▆ ▆ ▆ ▅ ▅ ▅ ▅ ▅ ▄ ▄ ▄ ▄ ▄ ▄
  energy  ▇ ▇ ▆ ▆ ▆ ▅ ▅ ▅ ▄ ▄ ▃ ▃ ▃ ▂ ▂ ▂ ▁ ▁ ▂ ▅ ▇ █ █ █ ▇ ▇ ▇ ▇ ▆ ▅ ▅ ▅ ▄ ▄ ▄ ▃ ▃ ▃ ▂ ▂ ▂ ▁ ▁ ▁ ▃ ▆ █ █
  clean   █ █ █ █ █ █ ▇ ▇ ▇ ▇ ▇ ▇ ▆ ▆ ▆ ▆ ▆ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▅ ▄ ▄ ▄ █ █ █ █ █ █ ▇ ▇ ▇ ▇ ▇ ▇ ▆ ▆ ▆ ▆ ▆ ▆ ▆ ▅
  mood    J J J J J J c c c c c c S S S S S S z z z J c c c c c c J J J c c c c c c S S S S S S z z z z c
  visit   ^                 ^                 ^                   ^

mood key: J joyful  c content  - meh  H hungry  B bored  S sleepy  D dirty  z asleep
```

```
day  time   on arrival                              after the visit                         what was done
  1  08:00  content  T 72 F 64 E 80 C 88            joyful   T100 F 98 E 73 C 88            fill bowl, play, pet x2, top up bowl
  1  12:40  content  T 95 F 70 E 36 C 67            asleep   T 91 F100 E 29 C100            fill bowl, wash, play, pet x2, tuck in
  1  17:20  joyful   T 94 F 78 E 72 C 82            joyful   T 90 F100 E 65 C 82            fill bowl, play, pet x2
  1  22:00  sleepy   T 84 F 72 E 28 C 61            asleep   T 80 F100 E 21 C100            fill bowl, wash, play, pet x2, tuck in
  2  08:00  meh      T 40 F 47 E 31 C 58            asleep   T 64 F100 E 17 C100            fill bowl, wash, play x2, pet x2, top up bowl, tuck in
  2  12:40  joyful   T100 F 79 E 74 C 82            joyful   T 96 F100 E 67 C 82            fill bowl, play, pet x2
  2  17:20  sleepy   T 91 F 72 E 29 C 61            asleep   T 87 F100 E 22 C100            fill bowl, wash, play, pet x2, tuck in
  2  22:00  joyful   T 90 F 79 E 73 C 82            joyful   T 86 F100 E 66 C 82            fill bowl, play, pet x2
  3  08:00  content  T 48 F 48 E 95 C 41            joyful   T 72 F100 E 81 C100            fill bowl, wash, play x2, pet x2, top up bowl
  3  12:40  content  T 96 F 72 E 43 C 79            content  T 92 F100 E 36 C 79            fill bowl, play, pet x2
  3  17:20  asleep   T 91 F 75 E 40 C 59            asleep   T 91 F 78 E 40 C 59            pet, fill bowl
  3  22:00  content  T 93 F 55 E 71 C 41            joyful   T 89 F 89 E 64 C100            fill bowl, wash, play, pet x2
  5  08:00  hungry   T 22 F 25 E 76 C 50            joyful   T 78 F 87 E 62 C100            fill bowl, feed, wash, play x2, pet x2, top up bowl  <- first visit after a missed day
  5  12:40  sleepy   T 73 F 59 E 25 C 79            asleep   T100 F 93 E 18 C 79            fill bowl, play, pet x2, top up bowl, tuck in
  5  17:20  content  T 74 F 72 E 74 C 61            joyful   T 70 F100 E 67 C100            fill bowl, wash, play, pet x2
  5  22:00  sleepy   T 95 F 72 E 29 C 79            asleep   T 91 F100 E 22 C 79            fill bowl, play, pet x2, tuck in
  6  08:00  meh      T 50 F 47 E 30 C 37            asleep   T 74 F100 E 16 C100            fill bowl, wash, play x2, pet x2, top up bowl, tuck in
  6  12:40  joyful   T 80 F 79 E 74 C 82            joyful   T 76 F100 E 67 C 82            fill bowl, play, pet x2
  6  17:20  sleepy   T 71 F 72 E 29 C 61            asleep   T 99 F100 E 22 C100            fill bowl, wash, play, pet x2, top up bowl, tuck in
  6  22:00  content  T 73 F 79 E 73 C 82            joyful   T100 F100 E 66 C 82            fill bowl, play, pet x2, top up bowl
  7  08:00  content  T 61 F 48 E 95 C 41            joyful   T 85 F100 E 81 C100            fill bowl, wash, play x2, pet x2, top up bowl
  7  12:40  content  T 80 F 72 E 43 C 79            content  T 76 F100 E 36 C 79            fill bowl, play, pet x2
  7  17:20  asleep   T 75 F 75 E 40 C 59            asleep   T 75 F 78 E 40 C 59            pet, fill bowl
  7  22:00  content  T 78 F 55 E 71 C 41            joyful   T 74 F 89 E 64 C100            fill bowl, wash, play, pet x2
```

```
scenario                                                               | fine | joyful content  meh | hungry bored sleepy dirty | asleep | avg  | urgent h (T/F/E/C)  | lowest (T/F/E/C) | bond
-----------------------------------------------------------------------|------|---------------------|---------------------------|--------|------|---------------------|------------------|----------
4 visits a day, day 4 missed, app closed between visits                |  74% |    27%     34%   1% |    13%    0%    12%    0% |    12% |   69 |     0.0/0.0/6.3/0.0 |       22/25/4/37 | 12 -> 34
```

---

## Things to know

1. **Doozer is sleepy about a fifth of the time, and no tuning of rates changes that.** A need is "low" under 30 and Doozer only falls asleep by itself at 4, so on its own it is sleepy for the last 26 of every 96 points of energy: 27% of its waking life, at any drain rate. Tucking it in at visits brings that down to 17–23%. It does no harm (it naps, and wakes rested), but the Pill will read "is sleepy" for a few hours most days. If that turns out to feel like nagging once the Pill exists, the fix is a rule change for the owner to make, not a number: let Doozer doze off on its own earlier (at 15, say), or only call it sleepy below 20. I have left the spec's rule alone.
2. **Mornings are the tight spot.** A night is ten hours and the catch-up cap is twelve, so "fine after a normal night" and "sulky after a missed day" are only two hours apart. With the tuned rates about one morning in twelve finds Doozer a little hungry or bored (one in five at three visits a day). Making mornings safer would make a missed day less noticeable; this is the balance point.
3. **Neglect is never worse than one missed day,** because of the cap. A week away after a thorough visit ends at tummy 33, fun 34, clean 38: mood *meh*, nothing actually low. A week away after an ordinary visit ends hungry. Either way one visit fixes it. This is the spec's intent ("Doozer never dies and never leaves") and a test holds it.
4. **Each bowl serving wastes two points:** it is eaten at exactly 70 and adds 32, but the meter stops at 100. Harmless; mentioned so nobody hunts for a bug.
5. **The schedule is a model, not data.** The visitor never forgets the bowl, always washes, and plays until fun is over 80. A real owner will be sloppier and Doozer will be a little less content than these figures. The right time to revisit the numbers is after a few real days with the Pill (Phase 6); they all live in one file.
