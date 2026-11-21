# Changelog

All notable changes to CircleFlix are listed here.

## 1.0.0 — 2026-11-21

First public release.

### Catalog
- Home with trending titles, fresh uploads, per-category rows and Continue Watching
- Movies, Series and Browse pages limited to video categories, with a year filter
- FTP Library: browse every CircleFTP index server as a poster grid, with filter and sorting
- Search across the whole catalog

### Player
- Plays MKV/MP4 with EAC3/AC3/DTS audio and HEVC video through a bundled FFmpeg gateway
- Audio-language and subtitle switching (embedded tracks and sidecar files), three subtitle sizes
- Seek anywhere, playback speed, next-episode countdown, fullscreen, keyboard shortcuts
- Live download speed and cached-ahead indicator on the seek bar
- Mini player: keep watching in a corner while browsing

### Downloads
- Download a single file, a whole season, or a whole FTP folder
- Two parallel downloads with a queue, pause/resume, resumable after restart
- Files organised as `Downloads/Circle Download/<Title (Year)>/<Season>/<file>`
- Downloads page groups files into one expandable folder per title, seasons inside
- Finished downloads play from disk

### Profile and app
- First-run welcome: name (required) and picture (optional) with a photo cropper
- Profile page: total watch time, favourite time of day, favourite categories, most watched titles
- Watch history with progress and resume, My List
- Dark and light themes
- Opening animation, version label, About section with repository and bug-report links
- Window locked to default size or maximised/fullscreen

### Fixed before release
- Audio out of sync with the picture after seeking
- Loading spinner staying on screen while the video was playing
- Unclear error when a server is offline or a file is missing
- Profile picture upload rejecting every image
