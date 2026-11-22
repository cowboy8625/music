// Baritone Toggle: shows chord-sheet chords as baritone (B) shapes without changing the note.
// A baritone tuned B E A D F# B sits a 4th below standard, so the shape to play is the written chord + 5 half-steps.
const { Plugin, MarkdownView, setIcon, getIcon, editorInfoField } = require("obsidian");
const { ViewPlugin, Decoration, WidgetType } = require("@codemirror/view");
const { StateEffect, RangeSetBuilder } = require("@codemirror/state");

const SHIFT = 5;
const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const DEFAULT_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const INDEX = {};
SHARPS.forEach((n, i) => (INDEX[n] = i));
FLATS.forEach((n, i) => (INDEX[n] = i));
Object.assign(INDEX, { Cb: 11, Fb: 4, "E#": 5, "B#": 0 });
const FLAT_KEYS = new Set(["F", "Bb", "Eb", "Ab", "Db", "Gb", "Dm", "Gm", "Cm", "Fm", "Bbm", "Ebm"]);

const CHORD = /^(\(?)([A-G][#b]?)((?:maj|min|m|M|dim|aug|sus|add|alt|\+|°|ø|\d+|[#b]\d+)*)(?:\/([A-G][#b]?))?(\)?)$/;
const FILLER = /^(\|+:?|:?\|+|\(?x\d+\)?|\d+x|N\.?C\.?|-+|–|\.+|%|\/+|\[[^\]]*\])$/i;

// Note names to use, based on the song's key/capo frontmatter (shape key + 5).
function namesFor(frontmatter) {
  const m = /^([A-G][#b]?)(m?)/.exec(String((frontmatter && frontmatter.key) || "").trim());
  if (!m || INDEX[m[1]] === undefined) return DEFAULT_NAMES;
  const capo = parseInt((frontmatter && frontmatter.capo) || 0, 10) || 0;
  const root = (((INDEX[m[1]] - capo + SHIFT) % 12) + 12) % 12;
  if (FLAT_KEYS.has(FLATS[root] + m[2])) return FLATS;
  // Sharp/natural keys: common spellings (Bb, Eb, Ab...), but the key's own scale notes use sharps.
  const names = DEFAULT_NAMES.slice();
  const steps = m[2] ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  for (const s of steps) names[(root + s) % 12] = SHARPS[(root + s) % 12];
  return names;
}

function transposeChord(token, names) {
  const m = CHORD.exec(token);
  if (!m) return token;
  // A chord written with a sharp/flat keeps that style; naturals follow the key.
  const pick = (note) => (note[1] === "#" ? SHARPS : note[1] === "b" ? FLATS : names)[(INDEX[note] + SHIFT) % 12];
  let out = m[1] + pick(m[2]) + m[3];
  if (m[4]) out += "/" + pick(m[4]);
  return out + m[5];
}

function isChordLine(line) {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  return tokens.some((t) => CHORD.test(t)) && tokens.every((t) => CHORD.test(t) || FILLER.test(t));
}

// Returns [{text, chord}] pieces, keeping each chord in its original column.
function transposeLinePieces(line, names) {
  const pieces = [];
  let col = 0;
  for (const m of line.matchAll(/\S+/g)) {
    const isChord = CHORD.test(m[0]);
    const text = isChord ? transposeChord(m[0], names) : m[0];
    let gap = m.index - col;
    if (gap < 1 && col > 0) gap = 1;
    if (gap > 0) pieces.push({ text: " ".repeat(gap), chord: false });
    pieces.push({ text, chord: isChord });
    col += Math.max(gap, 0) + text.length;
  }
  return pieces;
}

function transposeLine(line, names) {
  return transposeLinePieces(line, names).map((p) => p.text).join("");
}

function transposeBlock(text, names) {
  return text
    .split("\n")
    .map((l) => (isChordLine(l) ? transposeLine(l, names) : l))
    .join("\n");
}

// ---------- Live preview / source mode ----------
const refreshEffect = StateEffect.define();

class ChordLineWidget extends WidgetType {
  constructor(pieces) {
    super();
    this.pieces = pieces;
    this.key = pieces.map((p) => p.text).join("");
  }
  eq(other) {
    return other.key === this.key;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "baritone-line";
    for (const p of this.pieces) {
      if (p.chord) {
        const s = el.createSpan({ cls: "chord-sheet-chord-name chord-sheet-chord-highlight", text: p.text });
        s.setAttr("data-baritone", "");
      } else el.appendText(p.text);
    }
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

function buildEditorPlugin(plugin) {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = this.build(view);
      }
      update(u) {
        const refreshed = u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshEffect)));
        if (u.docChanged || u.viewportChanged || refreshed) this.decorations = this.build(u.view);
      }
      build(view) {
        const builder = new RangeSetBuilder();
        if (!plugin.enabled) return builder.finish();
        let names = DEFAULT_NAMES;
        const info = view.state.field(editorInfoField, false);
        if (info && info.file) {
          const cache = plugin.app.metadataCache.getFileCache(info.file);
          names = namesFor(cache && cache.frontmatter);
        }
        const doc = view.state.doc;
        let inChords = false;
        for (let i = 1; i <= doc.lines; i++) {
          const line = doc.line(i);
          const t = line.text.trim();
          if (t.startsWith("```")) {
            inChords = inChords ? false : /^```chords/.test(t);
            continue;
          }
          if (inChords && line.length && isChordLine(line.text)) {
            builder.add(line.from, line.to, Decoration.replace({ widget: new ChordLineWidget(transposeLinePieces(line.text, names)) }));
          }
        }
        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations }
  );
}

// ---------- Plugin ----------
module.exports = class BaritoneTogglePlugin extends Plugin {
  async onload() {
    const data = (await this.loadData()) || {};
    this.enabled = !!data.enabled;
    this.icon = getIcon("guitar") ? "guitar" : "music";
    this.buttons = new Set();

    this.registerEditorExtension(buildEditorPlugin(this));

    // Runs before Chord Sheets (sort order 0) so it renders the baritone chords, diagrams included.
    this.registerMarkdownPostProcessor((el, ctx) => {
      if (!this.enabled) return;
      const codes = el.querySelectorAll('code[class*="language-chords"]');
      if (!codes.length) return;
      const names = namesFor(ctx.frontmatter);
      codes.forEach((code) => (code.textContent = transposeBlock(code.textContent, names)));
    }, -1000);

    this.addCommand({ id: "toggle", name: "Toggle baritone (B) chords", callback: () => this.toggle() });

    this.app.workspace.onLayoutReady(() => this.addButtons());
    this.registerEvent(this.app.workspace.on("layout-change", () => this.addButtons()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.addButtons()));
    this.applyState();
  }

  onunload() {
    for (const b of this.buttons) b.remove();
    document.body.classList.remove("baritone-on");
  }

  addButtons() {
    this.app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || (view.baritoneBtn && view.baritoneBtn.isConnected)) return;
      view.baritoneBtn = view.addAction(this.icon, "Baritone (B) chords", () => this.toggle());
      view.baritoneBtn.addClass("baritone-toggle-btn");
      this.buttons.add(view.baritoneBtn);
    });
    this.applyButtonState();
  }

  applyButtonState() {
    for (const b of this.buttons) {
      if (!b.isConnected) {
        this.buttons.delete(b);
        continue;
      }
      b.toggleClass("is-active", this.enabled);
      b.setAttr("aria-label", this.enabled ? "Baritone (B) chords: on" : "Baritone (B) chords: off");
    }
  }

  async toggle() {
    this.enabled = !this.enabled;
    await this.saveData({ enabled: this.enabled });
    this.applyState();
  }

  applyState() {
    document.body.toggleClass("baritone-on", this.enabled);
    this.applyButtonState();
    this.app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) return;
      const cm = view.editor && view.editor.cm;
      if (cm) cm.dispatch({ effects: refreshEffect.of(null) });
      if (view.previewMode) view.previewMode.rerender(true);
    });
  }
};
