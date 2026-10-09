# Schematizer — Spec v1

A browser app for drawing block diagrams and simple circuit and electronics schematics on a grid canvas (in the style of draw.io).

**Tech:** Vite + React + TypeScript, with SVG rendering. Runs locally in the browser. The UI is in English.

---

## 1. Canvas
- Grid background (minor and major lines) that scales with zoom.
- Pan with middle mouse or Space+drag. Zoom with the mouse wheel, centered on the cursor.
- Snap to grid (toggle).
- Drag a box on empty space to select several items. Shift+click adds to or removes from the selection.
- Undo/redo for every action.

## 2. Objects (components)
An object is a group made of:
- **Body**: an uploaded image, and/or shapes drawn with the box and line tools.
- **Label**: name text that can be moved freely relative to the object.
- **Nodes**: named connection points.

Actions:
- Move, resize (images keep their aspect ratio when Shift is held), rotate 90°, flip horizontal/vertical, delete.
- Z-order: bring to front, send to back.

### Nodes
- Placed by clicking anywhere on the object. They snap to the object's edge when close to it.
- Properties: name, optional pin number, and label visibility.
- The node's label can be moved.

### Box and line tools (for building objects)
- The **box tool** draws a rectangle: stroke, fill, corner radius, and text inside. You can add nodes to it.
- The **line tool** draws a polyline shape. It is not a wire, and it is not part of any net.
- Shapes can be grouped with images or other shapes into one object.
- Uploaded images are embedded in the project file as data URLs.

## 3. Wires (connections)
- **Create**: click a node, optionally click on empty canvas to add corners, then click the target:
  - a **node** connects the wire to it;
  - a point on an **existing wire** creates a **junction** (a filled dot).
- If you click the target node without adding any corners, the wire is **auto-routed**.
- **Orthogonal lock** (toolbar toggle): when ON, wires use only horizontal and vertical segments. When OFF, segments can be at any angle.
- **Editing**:
  - Double-click a wire to add a corner at that point.
  - Drag a corner to move it.
  - Drag a segment to shift it sideways (orthogonal mode).
  - Delete a corner with right-click → Remove corner.
- **When an object moves**: the wire's manual corners stay where they are, and only the last segment(s) at each end stretch to follow the node.
- **Properties**: thickness, color, style (solid / dashed / dotted / dash-dot), corner radius (rounded by default), and optional arrowheads at the start and end.
- **Nets**: wires joined through junctions or shared nodes form a net. Clicking a wire with Alt highlights its whole net. Net labels (for example GND or VCC) connect nodes by name without drawing a wire.

### Auto-routing
Router: A* search on the grid. It ranks routes by these priorities, highest first:
1. **Fewest collisions.** Collisions are passing through objects, overlapping other wires, and crossing other wires.
2. Fewest bends.
3. Shortest length.

### Organize connections (button, works on the selected wires)
- Re-routes the selected wires to reduce crossings and collisions.
- Snaps all corners to the grid.
- Leaves unselected wires untouched.

## 4. Copy / paste
- Ctrl+C / Ctrl+V / Ctrl+D (duplicate). The pasted copy is offset by one grid step from the original.
- A wire is copied only when **both** of its ends are inside the selection. Junctions are included.
- Uses the system clipboard as JSON, so it works between tabs and between project files.

## 5. Files
- Save and open `.schematizer.json` files.
- Autosave to the browser's localStorage.
- Export to SVG and PNG. PDF comes later.

## 6. Extras (after the core)
- Symbol library: save an object, then drag new copies onto the canvas.
- Free text tool.
- Align and distribute.
- Properties side panel and a keyboard shortcut sheet.

---

## Build order
1. Canvas: grid, pan/zoom, selection, undo/redo, save/load.
2. Objects: image upload, label, nodes, move/rotate/flip.
3. Wires: manual drawing, rounded corners, styles, editing corners, orthogonal lock, stretching when objects move.
4. Junctions (wire-to-wire connections) and nets.
5. Copy/paste including wires.
6. Box tool, line tool and grouping.
7. Auto-router and the Organize button.
8. Exports, net labels, symbol library and other extras.
