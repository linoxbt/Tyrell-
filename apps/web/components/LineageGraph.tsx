"use client";

import { Controls, Handle, MarkerType, Position, ReactFlow, type NodeProps } from "@xyflow/react";
import { useMemo } from "react";
import { bodyText, CLS_STYLE, KIND, LANE_COLOR, short, type Graph, type ViewMemory } from "@/lib/view";

function MemoryNode({ data }: NodeProps) {
  const m = (data as { m: ViewMemory }).m;
  return (
    <div
      className="w-[230px] rounded-xl bg-white px-3 py-2.5 text-[11px] leading-tight shadow-[0_2px_10px_rgba(15,16,32,0.06)]"
      style={{ borderLeft: `4px solid ${LANE_COLOR[m.lane] ?? "#999"}`, outline: m.quarantined ? "2px dashed #e11d48" : "1px solid #ececf1", outlineOffset: m.quarantined ? 2 : 0 }}
      title={m.clsReason}
    >
      <Handle type="target" position={Position.Left} className="!bg-stone-400" />
      <div className="mb-1 flex items-center gap-1.5">
        <span className="font-semibold">{m.laneName}</span>
        <span className="text-stone-500">{KIND[m.kind]}</span>
        <span className={`ml-auto rounded px-1 ${CLS_STYLE[m.cls]}`}>{m.cls}</span>
        {m.quarantined && <span className="rounded bg-red-600 px-1 font-semibold text-white">Q</span>}
      </div>
      <div className="line-clamp-3 text-stone-700">{bodyText(m)}</div>
      <div className="mono mt-1 text-[10px] text-stone-400">{short(m.id, 4)}</div>
      <Handle type="source" position={Position.Right} className="!bg-stone-400" />
    </div>
  );
}

function SourceNode({ data }: NodeProps) {
  return (
    <div className="w-[170px] rounded-full border border-rose-300 bg-rose-50 px-3 py-2 text-center text-[11px] font-medium text-rose-800">
      {(data as { label: string }).label}
      <Handle type="source" position={Position.Right} className="!bg-red-400" />
    </div>
  );
}

const nodeTypes = { memory: MemoryNode, source: SourceNode };

export function LineageGraph({ graph, onSelect }: { graph: Graph; onSelect?: (id: string) => void }) {
  const edges = useMemo(() => graph.edges.map((e) => ({ ...e, markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 } })), [graph.edges]);
  if (graph.nodes.length === 0) return <p className="p-6 text-sm text-stone-500">Nothing to show yet.</p>;
  return (
    <div className="grid-bg h-[600px] rounded-2xl border border-line bg-white" data-testid="lineage-graph" data-memories={graph.memoryIds.join(",")} data-edges={graph.edges.length}>
      <ReactFlow
        key={graph.memoryIds.join(",")} // remount so fitView runs for each new graph (e.g. a different seed)
        nodes={graph.nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.12, maxZoom: 1.6 }}
        nodesDraggable={false}
        nodesConnectable={false}
        onNodeClick={(_e, n) => n.type === "memory" && onSelect?.(n.id)}
        proOptions={{ hideAttribution: true }}
      >
        
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
