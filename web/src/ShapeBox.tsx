// A shape placement on the page, drawn from the same path `pdf-stamp` gets.
import { createMemo } from "solid-js";
import type { ShapePlacement } from "./placement";
import { drawing, svgPath } from "./shapes";

export function ShapePreview(props: { placement: ShapePlacement }) {
  const p = () => props.placement;
  const d = createMemo(() => drawing(p().shape, p().style, p().width, p().height, p().ends));
  return (
    <svg class="shape-preview" viewBox={`0 0 ${p().width} ${p().height}`} preserveAspectRatio="none" aria-hidden="true">
      <path
        d={svgPath(d().path, p().height)}
        fill={d().fill ?? "none"}
        stroke={d().stroke?.color ?? "none"}
        stroke-width={String(d().stroke?.width ?? 0)}
        stroke-linecap={d().rounded ? "round" : "butt"}
        stroke-linejoin={d().rounded ? "round" : "miter"}
      />
    </svg>
  );
}
