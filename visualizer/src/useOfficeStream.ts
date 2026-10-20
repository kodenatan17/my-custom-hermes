import { useCallback, useEffect, useReducer, useState } from "react"
import { initialInteractionState, interactionReducer } from "./chat/model.mjs"
import { playDemo } from "./demo"
import { initialState, reducer, type OfficeEvent } from "./office"

export type Connection = "connecting" | "live" | "offline" | "demo"

/** Chat channel read marks: events with seq >= max(baseline, seen[agent]) are unread. Lives here to survive view toggles. */
export type UnreadState = { baseline: number | null; seen: Record<string, number> }

const params = new URLSearchParams(location.search)
const BRIDGE_URL = params.get("bridge") ?? "ws://localhost:4777"

/** Streams events from the opencode office-bridge plugin, or a scripted demo. */
export function useOfficeStream(demo: boolean) {
  const [state, dispatch] = useReducer(reducer, initialState)
  // Agent Chat View store: fed only by real bridge messages below (never by the demo), merged across reconnects.
  const [interactions, chat] = useReducer(interactionReducer, initialInteractionState)
  const [unread, setUnread] = useState<UnreadState>({ baseline: null, seen: {} })
  // The first replay is history, not news: start counting unread after it.
  useEffect(() => {
    if (interactions.hellos > 0) setUnread((u) => (u.baseline === null ? { ...u, baseline: interactions.seq } : u))
  }, [interactions.hellos, interactions.seq])
  const markSeen = useCallback(
    (id: string, seq: number) => setUnread((u) => (u.seen[id] === seq ? u : { ...u, seen: { ...u.seen, [id]: seq } })),
    [],
  )
  const [connection, setConnection] = useState<Connection>(demo ? "demo" : "connecting")

  useEffect(() => {
    dispatch({ type: "reset" })
    if (demo) {
      setConnection("demo")
      return playDemo(
        (event) => dispatch({ type: "event", event }),
        () => dispatch({ type: "reset" }),
      )
    }

    let ws: WebSocket | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    let closed = false

    const connect = () => {
      setConnection((c) => (c === "live" ? "offline" : c === "demo" ? "connecting" : c))
      ws = new WebSocket(BRIDGE_URL)
      ws.onopen = () => setConnection("live")
      ws.onmessage = (msg) => {
        let data: OfficeEvent | { type: "hello"; replay: OfficeEvent[] }
        try {
          data = JSON.parse(msg.data as string)
        } catch {
          chat({ type: "parseError" })
          return
        }
        if (!data || typeof data !== "object") return chat({ type: "parseError" })
        if (data.type === "hello") {
          dispatch({ type: "reset" })
          for (const event of Array.isArray(data.replay) ? data.replay : []) dispatch({ type: "event", event })
          chat({ type: "hello", replay: data.replay, now: Date.now() })
        } else {
          dispatch({ type: "event", event: data })
          chat({ type: "event", event: data, now: Date.now() })
        }
      }
      ws.onclose = () => {
        if (closed) return
        setConnection("offline")
        retry = setTimeout(connect, 2000)
      }
    }
    connect()

    return () => {
      closed = true
      clearTimeout(retry)
      ws?.close()
    }
  }, [demo])

  return { state, connection, interactions, unread, markSeen }
}
