# The animated TUI in the README. Regenerate from the repository root:
#
#   vhs docs/demo/tui.tape
#
# docs/demo/play.ts drives Tinker's own reducer and renderer through a scripted timeline:
# every frame is the real TUI, and the sessions, PRs and machine figures are invented.

Output assets/tui.gif

Set Shell "bash"
Set FontSize 15
Set Width 1280
Set Height 700
Set Padding 20
Set Framerate 12
Set PlaybackSpeed 1.0
Set Theme "Catppuccin Mocha"
Set WindowBar Colorful
Set BorderRadius 10

Hide
Type `export TINKER_LINKS=0; clear; bun docs/demo/play.ts`
Enter
Sleep 150ms
Show

Sleep 36s

Hide
Ctrl+C
