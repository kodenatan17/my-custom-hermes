import { useEffect, useMemo } from "react"
import { CanvasTexture, SRGBColorSpace } from "three"
import { AGENT_BY_ID, CATEGORY_STYLE } from "../agents"
import type { OfficeState } from "../office"

const W = 1280
const H = 512

/** Whiteboard on the back wall, redrawn from live state as a canvas texture. */
export function TaskBoard({ state, position }: { state: OfficeState; position: [number, number, number] }) {
  const canvas = useMemo(() => Object.assign(document.createElement("canvas"), { width: W, height: H }), [])
  const texture = useMemo(() => {
    const t = new CanvasTexture(canvas)
    t.colorSpace = SRGBColorSpace
    t.anisotropy = 4
    return t
  }, [canvas])

  useEffect(() => {
    const ctx = canvas.getContext("2d")!
    ctx.fillStyle = "#fbfbf9"
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = "#3a3d44"
    ctx.font = "600 34px Inter, sans-serif"
    ctx.fillText("Papan Tugas", 36, 58)

    const entries = Object.entries(state.agents).sort((a, b) => b[1].updated - a[1].updated)
    const columns: { title: string; filter: (s: string) => boolean; tint: string }[] = [
      { title: "Dikerjakan", filter: (s) => s === "working", tint: "#fde7b0" },
      { title: "Selesai", filter: (s) => s === "done", tint: "#d5f0d9" },
      { title: "Perlu dicek", filter: (s) => s === "error", tint: "#fbd0d0" },
    ]
    const colW = (W - 72) / columns.length
    columns.forEach((col, ci) => {
      const x0 = 36 + ci * colW
      const items = entries.filter(([, a]) => col.filter(a.status))
      ctx.fillStyle = "#6b7280"
      ctx.font = "500 24px Inter, sans-serif"
      ctx.fillText(`${col.title} (${items.length})`, x0, 104)
      ctx.strokeStyle = "#e5e7eb"
      ctx.lineWidth = 2
      if (ci > 0) {
        ctx.beginPath()
        ctx.moveTo(x0 - 14, 80)
        ctx.lineTo(x0 - 14, H - 30)
        ctx.stroke()
      }
      items.slice(0, 8).forEach(([id, a], i) => {
        const x = x0 + (i % 2) * (colW / 2)
        const y = 124 + Math.floor(i / 2) * 92
        const agent = AGENT_BY_ID.get(id)
        ctx.fillStyle = col.tint
        ctx.fillRect(x, y, colW / 2 - 18, 78)
        ctx.fillStyle = agent ? CATEGORY_STYLE[agent.category].color : "#555"
        ctx.fillRect(x, y, 6, 78)
        ctx.fillStyle = "#1f2937"
        ctx.font = "600 21px Inter, sans-serif"
        ctx.fillText(agent?.name ?? id, x + 16, y + 30, colW / 2 - 44)
        ctx.fillStyle = "#4b5563"
        ctx.font = "18px Inter, sans-serif"
        ctx.fillText(a.task ?? a.activity ?? "", x + 16, y + 58, colW / 2 - 44)
      })
    })
    texture.needsUpdate = true
  }, [state.agents, canvas, texture])

  return (
    <group position={position}>
      <mesh castShadow>
        <boxGeometry args={[5.3, 2.2, 0.08]} />
        <meshStandardMaterial color="#c9ccd2" />
      </mesh>
      <mesh position={[0, 0, 0.045]}>
        <planeGeometry args={[5.1, 2.04]} />
        <meshStandardMaterial map={texture} />
      </mesh>
      <mesh position={[0, -1.12, 0.1]}>
        <boxGeometry args={[4, 0.05, 0.12]} />
        <meshStandardMaterial color="#c9ccd2" />
      </mesh>
    </group>
  )
}
