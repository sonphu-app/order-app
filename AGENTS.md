# AGENTS.md

## Project
Internal Order App for THÉP SƠN PHÚ. React + Vite PWA with Supabase backend.

## Core rule
Do not rewrite or simplify working features. Before editing, read the relevant page/component and preserve existing behavior. Make small, targeted changes.

## Current stack
- React 19 + Vite
- react-router-dom
- Supabase database, realtime, storage, edge function
- PWA/service worker + Web Push
- Fabric.js / react-easy-crop for image editing

## Main routes
- / HomePage
- /create CreateOrder
- /order/:id OrderDetail
- /chat group Chat
- /account Account
- Login shown when no current user

## Important data
Tables referenced by current code: users, orders, order_messages, order_message_images, order_images, order_edit_history, group_messages, group_message_images, push_subscriptions. Storage bucket: order-images.

## Order status behavior to preserve
- New -> Done -> Delivered -> Completed is the normal flow.
- Completed before Delivered is allowed. In that case the order can remain visible in the Done and Completed views until Delivered is later recorded; after Delivered it should no longer remain in Done.
- Preserve done_by_name, delivered_by_name, completed_by_name and timestamps/updated_at behavior.

## Realtime / unread
Home listens to orders, order_messages and group_messages via Supabase Realtime. Unread counts use seen_by arrays and exclude messages sent by the current user.

## Push
Push events exist for new orders, order chat and group chat. iOS requires installed PWA/standalone mode. Do not remove service worker or push subscription logic when changing unrelated features.

## Safety for modifications
1. Inspect current implementation first.
2. State files to change.
3. Preserve existing DB field names and user-visible behavior unless explicitly asked to migrate.
4. Never delete features to fix one bug.
5. Do not commit secrets. Keep .env out of shared artifacts.
6. After edits run npm install if needed, then npm run build and lint relevant files.
