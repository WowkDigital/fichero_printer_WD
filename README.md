# Fichero Printer Lab

A browser app for experimenting with the Fichero 6181 / AiYin A4 thermal printer over Web Bluetooth. Built with Svelte 5, Vite, TypeScript and Tailwind CSS 4, and hosted on GitHub Pages.

## What it is

- **Low-level control**: connect to the printer and send raw commands over Bluetooth Low Energy.
- **Print lab**: print from image, text or test-pattern sources, with tunable dithering and job parameters.
- **Preview**: zoom (buttons, ctrl+wheel, pinch, drag to pan) and a margin overlay showing blank rows and white space around the ink, in millimetres.
- **Output modes** (header, next to Print): *Print*; *Blank run*, which sends all-white rows so the printer feeds the same paper with the same timing and motor sound without burning anything; and *Simulate*, which sends nothing and measures time and paper with the current pacing.
- **Algorithms gallery**: the current source rendered with every dither algorithm (or a threshold, gamma, brightness, contrast or halftone sweep) side by side, with synced zoom, one-click "Use" and a printable contact sheet.
- **Lab**: a timed ticker (date and time, lines of text or a counter, printed every N ms as one streamed job or as separate jobs) and parameter sweeps (density, chunk delay, chunk size, repeat) with a result table.
- **Packet inspector**: a live view of every packet sent and received, plus a raw hex console.
- **Demo mode**: a simulated printer for working on the app without hardware.

## Requirements

- A Chromium-based browser (Chrome, Edge, Opera, Samsung Internet) on Android, Windows, macOS, Linux or ChromeOS.
- The page must be served over HTTPS or from localhost.
- Not supported on Firefox, Safari or any iOS browser (iOS does not expose Web Bluetooth).

## Development

```sh
npm install
npm run dev     # start the dev server
npm run check   # type and Svelte checks
npm test        # run tests
npm run build   # production build into dist/
```

## Deployment

Pushes to `main` deploy automatically through GitHub Actions (`.github/workflows/deploy.yml`).

In the repository, go to **Settings → Pages** and set **Source** to **GitHub Actions**.

The Vite `base` is relative (`./`), so the app works under any repository path.

## Protocol summary

BLE service `0x18F0`. Commands are written to characteristic `0x2AF1` (write without response). Replies arrive on notify characteristic `0x2AF0`.

| Function | Bytes (hex) | Notes |
| --- | --- | --- |
| Wake up | `12 x 00` | 12 zero bytes |
| Model query | `10 FF 20 F0` | |
| Battery | `10 FF 50 F1` | |
| Status | `10 FF 40` | bit0 printing, bit1 cover open, bit2 no paper, bit4/bit6 overheated, bit5 charging |
| Density | `10 FF 10 00 n` | n: 0 light, 1 normal, 2 high |
| Paper mode | `10 FF 84 02` | continuous roll |
| Enable | `10 FF FE 01` | |
| Stop | `10 FF FE 45` | printer replies `AA` |
| Raster image | `1D 76 30 00 xL xH yL yH` + data | GS v 0; 1-bit rows, MSB first; 204 bytes/row (1632 dots) or 210 bytes/row (1680 dots) at 203 dpi |
| Feed | `10 FF F0 nL nH` | AiYin forward feed; 8 dots = 1 mm |
| Form feed | `1D 0C` | |

Default pacing: data is sent in 200-byte chunks, one chunk every 20 ms.

## Project layout

- `src/lib/core`: framework-free protocol and transport code.
- `src/lib/image`: dithering and test patterns.
- `src/lib/ui`: Svelte components.

## Disclaimer

This is an unofficial tool. It is not affiliated with, endorsed by, or supported by the printer vendor.
