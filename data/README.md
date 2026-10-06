# Data tools

Scripts for the colour palette and the example schemes. None of these are needed to run the pages.

## The palette

`paint-colors.js` is the House Painter palette: original colours with original names, grouped by family (`HP 1xx` whites, `HP 2xx` neutrals, `HP 3xx` blues, and so on). It is generated from a list in `build_palette.js`:

```bash
node data/build_palette.js
```

Add colours at the **end** of a family so that existing codes never change: saved schemes refer to colours by code.

## Extra colour books (optional, for your own use)

The paint studio can show more colour books beside the palette. If a file called `paint-colors-extra.js` sits in the project folder, its books appear as extra tabs. The file is git-ignored on purpose: paint makers own their names, codes and values, so they aren't part of this project.

To make one from data you download yourself (the current script reads Sherwin-Williams values from the [colornerd](https://github.com/jpederson/colornerd) data set and Behr values from behr.com's own colour data):

```bash
mkdir -p data/src
curl -L -o data/src/sw.json https://raw.githubusercontent.com/jpederson/colornerd/master/json/sherwin-williams.json
curl -L -A "Mozilla/5.0" -o data/src/behr_all.js https://www.behr.com/mainService/services/colornx/all.js
node data/build_colors.js
```

To add your own book, follow `build_colors.js`: it ends by writing

```js
(window.PAINT_COLORS.books ||= []).push({ id: 'mybrand', label: 'My brand', colors: [[code, name, hex], ...], popular: [code, ...] });
```

Schemes remember the book each colour came from (`b`), and a scheme that uses a book you don't have still shows its colours, as the hex it saved.

## Finding the nearest colour

```bash
node data/match_colors.js "#C35530" "#2A4F43"
```

prints the nearest colours (by CIEDE2000) in every loaded book.

## Schemes

`remap_schemes.js` turns every colour that came from an extra book into the nearest House Painter palette colour, so a scheme can be shared without anyone needing that book:

```bash
node data/remap_schemes.js houses/waterford-4563c/schemes examples/house-cozy-deco-emerald-brass.json
```

Before a file changes, a copy is kept in a `schemes-original/` folder beside it (git-ignored). The example schemes in this repository were made this way.

`build_house_schemes.js`, `build_more_schemes.js` and `add_accent_walls.js` are how the original example schemes were first written, with paint-maker colours. They need those books, so they only run if you have built `paint-colors-extra.js`.

## Other

- `ascii_js.js` rewrites non-ASCII characters in the page scripts as `\uXXXX`, so they read the same under any charset. Run it after editing them.
- `example-house.js` loads the example house for the other Node scripts.
- `color-math.js` is the colour maths (sRGB to CIELAB, CIEDE2000).
