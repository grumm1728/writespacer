import type { Rect } from "@/lib/types";

export type ConnectedComponent = Rect & {
  id: string;
  area: number;
  density: number;
  centerX: number;
  centerY: number;
};

export function detectConnectedComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  bounds: Rect,
  minArea: number,
) {
  const visited = new Uint8Array(width * height);
  const components: ConnectedComponent[] = [];
  const left = Math.max(0, Math.floor(bounds.left));
  const right = Math.min(width, Math.ceil(bounds.left + bounds.width));
  const top = Math.max(0, Math.floor(bounds.top));
  const bottom = Math.min(height, Math.ceil(bounds.top + bounds.height));

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const index = y * width + x;
      if (!mask[index] || visited[index]) {
        continue;
      }

      const component = floodFill(mask, visited, width, height, x, y);
      if (component.area < minArea || component.width < 1 || component.height < 1) {
        continue;
      }

      components.push({
        id: `component-${components.length + 1}`,
        ...component,
        density: component.area / Math.max(1, component.width * component.height),
        centerX: component.left + component.width / 2,
        centerY: component.top + component.height / 2,
      });
    }
  }

  return components;
}

function floodFill(
  mask: Uint8Array,
  visited: Uint8Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
) {
  const queueX = [startX];
  const queueY = [startY];
  visited[startY * width + startX] = 1;
  let cursor = 0;
  let left = startX;
  let right = startX;
  let top = startY;
  let bottom = startY;
  let area = 0;

  while (cursor < queueX.length) {
    const x = queueX[cursor];
    const y = queueY[cursor];
    cursor += 1;
    area += 1;
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);

    const neighbors: Array<[number, number]> = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];
    for (const [nextX, nextY] of neighbors) {
      if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) {
        continue;
      }
      const offset = nextY * width + nextX;
      if (!mask[offset] || visited[offset]) {
        continue;
      }
      visited[offset] = 1;
      queueX.push(nextX);
      queueY.push(nextY);
    }
  }

  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
    area,
  };
}
