import { test } from 'node:test';
import { loadWhiteboard } from './helpers/whiteboard.mjs';
import { checks } from './helpers/check.mjs';

test('whiteboard geometry', async (t) => {
  const ck = checks(t);

  const a = loadWhiteboard();

  // --- normalizedShapeBox: auch bei rueckwaerts gezogenen Formen ---
  ck('box normalises a backwards drag',
    JSON.stringify(a.normalizedShapeBox({ x: 100, y: 100, w: -60, h: -40 })) === JSON.stringify({ x: 40, y: 60, width: 60, height: 40 }),
    JSON.stringify(a.normalizedShapeBox({ x: 100, y: 100, w: -60, h: -40 })));

  // --- Rechteck ist ein Umriss: Rand trifft, hohle Mitte nicht ---
  const rect = { id: 's1', kind: 'rect', x: 100, y: 100, w: 200, h: 120, createdAt: 1 };
  ck('edge of a rectangle is hit', a.shapeTouchesPoint(rect, { x: 100, y: 160 }, 8));
  ck('hollow middle is not hit', !a.shapeTouchesPoint(rect, { x: 200, y: 160 }, 8));
  ck('far outside is not hit', !a.shapeTouchesPoint(rect, { x: 400, y: 160 }, 8));
  ck('opposite edge is hit', a.shapeTouchesPoint(rect, { x: 300, y: 160 }, 8));

  // --- Linie/Pfeil: nur nahe der Strecke ---
  const line = { id: 's2', kind: 'line', x: 0, y: 0, w: 100, h: 100, createdAt: 2 };
  ck('point on the line is hit', a.shapeTouchesPoint(line, { x: 50, y: 50 }, 8));
  ck('point off the line is not', !a.shapeTouchesPoint(line, { x: 50, y: 90 }, 8));
  ck('arrow behaves like a line', a.shapeTouchesPoint({ ...line, kind: 'arrow' }, { x: 20, y: 20 }, 8));

  // --- Stapelreihenfolge und Trefferpriorität ---
  a.setBoard({
    projectId: 'p', updatedAt: 0,
    strokes: [{ id: 'k1', points: [10, 10, 200, 200], width: 2, createdAt: 1 }],
    shapes: [{ id: 's1', kind: 'rect', x: 50, y: 50, w: 100, h: 100, width: 2, createdAt: 5 }],
    texts: [{ id: 't1', x: 300, y: 300, text: 'hallo', size: 18, createdAt: 9 }]
  });
  const order = a.whiteboardItems().map((i) => i.item.id).join(',');
  ck('items ordered oldest first', order === 'k1,s1,t1', order);

  // Strich und Form kreuzen sich bei (50,50); die neuere Form muss gewinnen
  const topHit = a.whiteboardItemAt({ x: 50, y: 50 }, 8);
  ck('newest item wins a hit test', topHit && topHit.item.id === 's1', topHit && topHit.item.id);
  const strokeOnly = a.whiteboardItemAt({ x: 180, y: 180 }, 8);
  ck('stroke still hit where nothing overlaps', strokeOnly && strokeOnly.item.id === 'k1', strokeOnly && strokeOnly.item.id);
  const textHit = a.whiteboardItemAt({ x: 310, y: 305 }, 8);
  ck('text is hit by its box', textHit && textHit.item.id === 't1', textHit && textHit.item.id);
  ck('empty space hits nothing', a.whiteboardItemAt({ x: 700, y: 700 }, 8) === null);

  // --- Verschieben ---
  const board = a.getBoard();
  a.moveWhiteboardItem('shape', board.shapes[0], 25, -10);
  ck('shape moved', board.shapes[0].x === 75 && board.shapes[0].y === 40, `${board.shapes[0].x},${board.shapes[0].y}`);
  a.moveWhiteboardItem('text', board.texts[0], -50, 5);
  ck('text moved', board.texts[0].x === 250 && board.texts[0].y === 305, `${board.texts[0].x},${board.texts[0].y}`);
  a.moveWhiteboardItem('stroke', board.strokes[0], 5, 5);
  ck('every stroke point moved', board.strokes[0].points.join(',') === '15,15,205,205', board.strokes[0].points.join(','));

  // --- Bounds pro Typ ---
  const sb = a.whiteboardItemBounds('stroke', { points: [10, 20, 110, 60, 40, 5] });
  ck('stroke bounds span all points', sb.x === 10 && sb.y === 5 && sb.width === 100 && sb.height === 55, JSON.stringify(sb));

  // --- Undo raeumt ueber alle drei Arrays hinweg ---
  a.setBoard({
    projectId: 'p', updatedAt: 0,
    strokes: [{ id: 'k1', points: [0, 0, 1, 1], createdAt: 1 }],
    shapes: [{ id: 's1', kind: 'rect', x: 0, y: 0, w: 10, h: 10, createdAt: 3 }],
    texts: [{ id: 't1', x: 0, y: 0, text: 'x', createdAt: 2 }]
  });
  a.undoWhiteboard();
  let b = a.getBoard();
  ck('undo removes the newest across types (shape)', b.shapes.length === 0 && b.texts.length === 1 && b.strokes.length === 1,
    `${b.strokes.length}/${b.shapes.length}/${b.texts.length}`);
  a.undoWhiteboard();
  b = a.getBoard();
  ck('then the text', b.texts.length === 0 && b.strokes.length === 1, `${b.strokes.length}/${b.texts.length}`);

  // --- Radierer erfasst Formen ---
  a.setBoard({
    projectId: 'p', updatedAt: 0, strokes: [],
    shapes: [{ id: 's1', kind: 'rect', x: 100, y: 100, w: 100, h: 100, createdAt: 1 }],
    texts: []
  });
  ck('eraser ignores the hollow middle', a.eraseWhiteboardAt({ x: 150, y: 150 }) === false, JSON.stringify(a.getBoard().shapes.length));
  ck('eraser removes a shape by its edge', a.eraseWhiteboardAt({ x: 100, y: 150 }) === true && a.getBoard().shapes.length === 0);

  await ck.settled();
});
