# LAN round delivery through the Tauri process

The app accepts grilling rounds through a write-only `POST /api/rounds` endpoint bound to `0.0.0.0:8787` by default, then emits the validated round into the in-memory Tauri board. We chose this small LAN-only ingress because agents need to submit without a browser or shared filesystem; authentication, query endpoints, and persistence remain deliberately out of scope for now.
