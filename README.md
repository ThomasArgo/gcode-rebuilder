<p align="center">
  <img src="assets/branding/gcode-rebuilder-logo-original.png" width="180" alt="GCode Rebuilder logo">
</p>

# GCode Rebuilder

Reconstruct deposited FDM G-code paths into downloadable STL geometry, directly in the browser. The resulting STL represents the material paths recorded in the G-code—not the original CAD model from before slicing.

<p>
  <a href="https://thomasargo.github.io/gcode-rebuilder/"><strong>Launch GCode Rebuilder</strong></a>
  &nbsp;·&nbsp;
  <a href="https://thomasargo.github.io/"><strong>View Thomas Argo’s Portfolio</strong></a>
</p>

## Contents

- [What it does](#what-it-does)
- [How to use it](#how-to-use-it)
- [Current features](#current-features)
- [Supported files and commands](#supported-files-and-commands)
- [Export formats](#export-formats)
- [Privacy](#privacy)
- [Known limitations](#known-limitations)
- [Technology](#technology)
- [Copyright and Use](#copyright-and-use)

## What it does

GCode Rebuilder reads the deposited extrusion moves in an FDM G-code file and turns them into a practical mesh you can inspect or export. It is useful when you need to review the printable paths in an existing file, inspect layers and bounds, or create a geometry reference from a print file when the original model is unavailable.

Everything happens on the device running the browser: the file is parsed, reconstructed, previewed, analyzed, and exported locally. Uploaded G-code is not sent to an application server.

Because G-code is already sliced, it describes tool movements rather than the original solid model. Reconstruction is therefore an approximation of deposited paths, not a way to recover the exact pre-sliced CAD or STL.

## How to use it

1. Open the [live application](https://thomasargo.github.io/gcode-rebuilder/).
2. Upload a `.gcode` or `.gco` file, or run the bundled Benchy sample.
3. Inspect the reconstructed model in the interactive 3D viewer.
4. Adjust mesh dimensions and filtering settings, then select **Rebuild** when needed.
5. Inspect layers with the layer-view controls and review the analysis report.
6. Download reconstructed geometry or the analysis report from **Export Mesh**.

## Current features

- Browser-local G-code parsing in a Web Worker with progress feedback.
- Reconstruction of deposited extrusion paths into closed-bead mesh geometry.
- Interactive Three.js viewer with orbit, pan, zoom, camera reset, fullscreen, orthographic view, wireframe mode, model color, and scene-color controls.
- Complete-model, up-to-selected-layer, and selected-layer viewing with smooth layer-range updates.
- Bundled 3DBenchy G-code sample for trying the workflow without uploading a file.
- G-code analysis for layers, dimensions, bounds, detected slicer metadata, nozzle and layer-height metadata, filament estimate, print speed, travel and extrusion distance, retractions, tool changes, command count, and warnings.
- Mesh settings for bead width, layer height, nozzle, arc resolution, filament diameter, and material density.
- Optional infill inclusion plus skirt/brim, support, and startup-purge-line filtering.
- Binary STL, ASCII STL, and JSON analysis-report downloads.

## Supported files and commands

Accepted upload types are `.gcode`, `.gco`, and plain-text G-code files.

The parser handles G0/G1 linear moves; G2/G3 arcs using I/J center offsets; G90/G91 absolute and relative positioning; M82/M83 absolute and relative extrusion; G92 coordinate and extrusion resets; and `T` tool-change commands. It also recognizes common slicer `TYPE:` and `FEATURE:` comments when applying filters.

## Export formats

- **Binary STL** — compact binary STL geometry reconstructed from the deposited paths.
- **ASCII STL** — text-based STL geometry reconstructed from the same deposited paths.
- **Report JSON** — the analysis data collected from the file and reconstruction, including dimensions, layer count, bounds, warnings, and detected metadata.

## Privacy

File contents remain in the browser. GCode Rebuilder parses, reconstructs, previews, and exports files locally; it does not upload G-code data to an application server.

## Known limitations

- Output represents deposited extrusion paths, not the exact original CAD model.
- Reconstruction quality depends on the commands, comments, and metadata available in the file.
- Unsupported or unusual slicer commands can affect the reconstructed result or appear as warnings.
- The mesh is a practical visualization of deposited material and does not simulate every printer, nozzle, or material behavior.

## Technology

JavaScript, Three.js, Web Workers, HTML, and CSS.

## Copyright and Use

Copyright © 2026 Thomas Argo. All rights reserved. This project and its source code are proprietary. No permission is granted to copy, modify, distribute, sublicense, sell, or use the source code or associated assets without prior written permission from the copyright holder.

This project is not open source. No permission is granted to copy, modify, redistribute, sublicense, sell, or reuse the source code or visual assets.
