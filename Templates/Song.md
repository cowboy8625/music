<%*
const title = tp.file.title.startsWith("Untitled") ? await tp.system.prompt("Song title") : tp.file.title;
const artist = await tp.system.prompt("Artist", "Bobby Stout");
const key = await tp.system.prompt("Key (e.g. G, C#m)");
const capo = await tp.system.prompt("Capo", "0");
const status = await tp.system.suggester(["learning", "known", "original"], ["learning", "known", "original"]);
await tp.file.move(`Songs/${artist}/${title}`);
-%>
---
artist: <% artist %>
key: <% key %>
capo: <% capo %>
tuning: Standard
status: <% status %>
tags:
  - song
custom-width: 100
---

```chords
[Intro]
<% tp.file.cursor() %>

[Verse 1]

[Chorus]

[Bridge]
```
