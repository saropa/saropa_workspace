| # | Group | Script | What it does | Full path | Done |
|---|-------|--------|-------------|-----------|------|
| 1 | Clean | build_runner_clean.py | `build_runner build --delete-conflicting-outputs` with Isar guard | D:\src\contacts\scripts\clean\build_runner_clean.py | |
| 2 | Clean | build_runner_deep_clean.py | Deep clean + rebuild: kills processes, clears caches, restores deps | D:\src\contacts\scripts\clean\build_runner_deep_clean.py | |
| 3 | Clean | build_runner_watch.py | `build_runner watch --use-polling-watcher` for reliable file watching | D:\src\contacts\scripts\clean\build_runner_watch.py | |
| 4 | Clean | dart_process_clean.py | Kills leaked Dart/Flutter tool-host processes hanging VS Code | D:\src\contacts\scripts\clean\dart_process_clean.py | |
| 5 | Clean | flutter_sdk_repair.py | Flutter SDK + Dart analyzer plugin repair (AOT/devtools/custom_lint) | D:\src\contacts\scripts\clean\flutter_sdk_repair.py | |
| 6 | Clean | gradle_clean.py | Wipes Gradle caches globally + per-project, rebuilds with verify | D:\src\contacts\scripts\clean\gradle_clean.py | |
| 7 | Audit | detect_duplicate_classes.py | Finds duplicate class declarations across Dart files | D:\src\contacts\scripts\audit\detect_duplicate_classes.py | |
| 8 | Audit | detect_duplicate_strings.py | Finds duplicate string literals for consolidation | D:\src\contacts\scripts\audit\detect_duplicate_strings.py | |
| 9 | Audit | detect_unused_methods.py | Detects potentially unused methods | D:\src\contacts\scripts\audit\detect_unused_methods.py | |
| 10 | Audit | sort_dart_imports.py | Sorts and deduplicates Dart imports alphabetically | D:\src\contacts\scripts\audit\sort_dart_imports.py | |
| 11 | Test | run_test.py | Reliable Flutter test runner for Windows (kills orphaned flutter_tester.exe) | D:\src\contacts\scripts\test\run_test.py | |
| 12 | Test | flutter_test_all.py | Runs all Flutter tests with Windows "command line too long" workaround | D:\src\contacts\scripts\test\flutter_test_all.py | |
| 13 | Test | fix_misused_test_matchers.py | Rewrites `expect(x.length, N)` to `expect(x, hasLength(N))` | D:\src\contacts\scripts\test\fix_misused_test_matchers.py | |
| 14 | Report | code_line_count.py | Line/byte/size counts grouped by extension and directory | D:\src\contacts\scripts\report\code_line_count.py | |
| 15 | Report | codebase_analyzer.py | Keyword analysis + screen description extraction | D:\src\contacts\scripts\report\codebase_analyzer.py | |
| 16 | Report | daily_report.py | JSON report of recent Git changes to Dart/JSON/YAML/assets | D:\src\contacts\scripts\report\daily_report.py | |
| 17 | Report | dependency_report.py | Flutter dependency report with optional upgrade capabilities | D:\src\contacts\scripts\report\dependency_report.py | |
| 18 | Report | github_report.py | PR-based changelog and feature inventory reports | D:\src\contacts\scripts\report\github_report.py | |
| 19 | Shared | _changelog_pipeline.py | Git commit log report with un-squashed PR history via GitHub API | D:\src\contacts\scripts\.shared\_changelog_pipeline.py | |
| 20 | Shared | _features_pipeline.py | GitHub PR feature inventory, grouped by area | D:\src\contacts\scripts\.shared\_features_pipeline.py | |
| 21 | AI | cluade_monitor.py | Monitors active Claude CLI agent sessions | D:\src\contacts\scripts\ai\cluade_monitor.py | |
| 22 | AI | qwen_ollama_setup.py | Automates Ollama install + model management + VS Code Continue setup | D:\src\contacts\scripts\ai\qwen_ollama_setup.py | |
| 23 | Antivirus | disable_antivirus.py | Manages Windows Defender exclusions for dev environments | D:\src\contacts\scripts\antivirus\disable_antivirus.py | |
| 24 | Emulator | emulator_debug_fix.py | Diagnoses/fixes Flutter debug disconnects on Android emulators | D:\src\contacts\scripts\emulator\emulator_debug_fix.py | |
| 25 | Build | debug_connect.py | Flutter Mobile Debug Connection Assistant launcher | D:\src\contacts\scripts\build\debug_connect.py | Y |
| 26 | Report | organize_reports.py | CLI entry point to organize/move files under reports/ | D:\src\contacts\reports\organize_reports.py | Y |
