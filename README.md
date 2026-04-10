# wiz-lights

## What this does

This project is a small **React + TypeScript** UI plus a tiny **local Node/TypeScript API server** that talks to **WiZ smart bulbs** over your local network using **UDP**.

The browser cannot send UDP packets directly, so the React UI calls the local API server, and the server talks to the bulb.

## Requirements

- Your computer and the WiZ bulb must be on the **same local network / Wi‑Fi**.
- The bulb must be **powered on**.

## Install

```bash
npm install
```

## Run (recommended)

Runs both the API server and the React dev server:

```bash
npm run dev:all
```

Then open the web app (Vite will print the URL), usually:

- http://localhost:5173

The API server runs at:

- http://localhost:5174

## Using the UI

- Click **Discover bulbs**.
- Select a bulb from the dropdown.
  - If discovery returns nothing, you can still type the bulb IP manually in the **IP** field.
- Pick a color. The bulb should update immediately.

## Troubleshooting

- If discovery doesn’t find bulbs:
  - Make sure you are on the same Wi‑Fi as the bulb.
  - Some routers block UDP broadcast between Wi‑Fi clients (“AP isolation”). Disable that setting.
  - Try entering the bulb IP manually.
- If you’re on macOS and nothing happens, check firewall settings (allow incoming connections for Node).

## Notes on latency

- Color changes are sent over LAN UDP to port `38899`, which is typically very fast.
- The UI sends a request on color change. If you want even lower latency while dragging a picker, we can add throttling/preview behavior.
