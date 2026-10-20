import { Canvas } from "@react-three/fiber"
import { useState } from "react"
import { ChatView } from "./chat/ChatView"
import { Hud } from "./hud/Hud"
import { Scene } from "./scene/Scene"
import { useIdleActivities } from "./useIdleActivities"
import { useOfficeStream } from "./useOfficeStream"
import { usePrayer } from "./usePrayer"

const startInDemo = new URLSearchParams(location.search).has("demo")
type View = "workflow" | "chat"
const startView: View = new URLSearchParams(location.search).get("view") === "chat" ? "chat" : "workflow"

export function App() {
  const [demo, setDemo] = useState(startInDemo)
  const [view, setView] = useState<View>(startView)
  const [focused, setFocused] = useState<string | null>(null)
  const { state, connection, interactions, unread, markSeen } = useOfficeStream(demo)
  const idleSpots = useIdleActivities(state.agents)
  const prayer = usePrayer(state.agents)
  // Agents at the musholla aren't at their hang-out spot.
  const hangouts = Object.fromEntries(Object.entries(idleSpots).filter(([, agent]) => !prayer.places[agent]))

  const switchView = (next: View) => {
    setView(next)
    const url = new URL(location.href)
    if (next === "chat") url.searchParams.set("view", "chat")
    else url.searchParams.delete("view")
    history.replaceState(null, "", url)
  }

  return (
    <div className="app">
      {/* Kept mounted (scene state survives the toggle) but paused and hidden in the chat view. */}
      <Canvas
        shadows
        dpr={[1, 2]}
        className="canvas"
        frameloop={view === "workflow" ? "always" : "never"}
        style={{ visibility: view === "workflow" ? "visible" : "hidden" }}
      >
        <Scene state={state} hangouts={hangouts} prayer={prayer} focused={focused} onSelect={setFocused} />
      </Canvas>
      {view === "workflow" ? (
        <Hud
          state={state}
          hangouts={hangouts}
          prayer={prayer}
          connection={connection}
          demo={demo}
          onToggleDemo={() => setDemo((d) => !d)}
          focused={focused}
          onSelect={setFocused}
        />
      ) : (
        <ChatView interactions={interactions} connection={connection} demo={demo} unread={unread} onSeen={markSeen} />
      )}
      <nav className="card tabs chat-viewtoggle" aria-label="View">
        <button className={view === "workflow" ? "active" : ""} onClick={() => switchView("workflow")}>
          Workflow View
        </button>
        <button className={view === "chat" ? "active" : ""} onClick={() => switchView("chat")}>
          Agent Chat View
        </button>
      </nav>
    </div>
  )
}
