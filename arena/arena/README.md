# Arena FPS — single-service multiplayer game

One Node server serves the game page AND the real-time multiplayer backend. One URL, no env vars.

## Run
    npm install
    npm start          # http://localhost:3001  (PORT env var overrides)
Open in 2+ windows: enter a name → Create Private Room → share the 5-letter code, or Quick Match.

## Play across networks (deploy)
Any Node host with persistent WebSockets: Render / Railway / Fly.io free tiers.
Build: `npm install`   Start: `npm start`.  Share the resulting https URL with friends anywhere.

## Controls
WASD move, Shift sprint, Space jump, Ctrl crouch, LMB fire, RMB zoom (sniper), R reload, 1-6 weapons
(rifle, SMG, shotgun, sniper, pistol, knife), Esc pause. Movement keys rebindable in Settings.

## Features
Rooms/codes/quick match/lobby/ready/host controls; TDM + FFA; 3 maps (Urban City, Desert Base, Warehouse with 2 floors);
server-authoritative damage, ammo, reloads, armor, headshots, assists, kill streaks, respawn; ray-vs-wall hit tests;
movement sanity checks + rate limiting; reconnect within 20s; minimap; kill feed; hit markers; settings
(FOV, crosshair, quality, shadows, fullscreen, key rebinding); synthesized audio; pooled particles.

## Known gaps
Box-model weapons/characters (no imported 3D assets), no explosions/smoke grenades, no loading screen, no lag compensation,
audio is synthesized (no sample files), "Loadout/Profile" are reduced to hotkey weapons and a saved name.
