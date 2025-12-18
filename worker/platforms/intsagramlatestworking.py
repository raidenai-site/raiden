async def listen(self) -> None:
    if not self.is_ready:
        return

    print("🧠 Listener Active (Simple Diff Mode)...")

    # 1. Mutation observer → asyncio event
    change_event = asyncio.Event()
    await self.page.expose_binding("onSidebarChange", lambda source: change_event.set())

    script = """
        () => {
            const sidebar = document.querySelector('div[class*="x1n2onr6"]');
            if (!sidebar) return;
            const observer = new MutationObserver(() => window.onSidebarChange());
            observer.observe(sidebar, { childList: true, subtree: true, characterData: true });
        }
    """
    try:
        await self.page.evaluate(script)
    except:
        pass

    # 2. Initial snapshot
    initial_data = await self.get_inbox()
    old_snapshot = {c["id"]: c["preview"] for c in initial_data}

    while self.is_ready:
        await change_event.wait()
        change_event.clear()

        try:
            # 3. New snapshot
            current_inbox = await self.get_inbox()
            new_snapshot = {c["id"]: c["preview"] for c in current_inbox}

            # If nothing changed, skip
            if new_snapshot == old_snapshot:
                continue

            # 4. Always update sidebar
            await manager.broadcast("sidebar", {
                "event": "sidebar_update",
                "chats": current_inbox
            })

            # 5. Find chats whose preview changed
            changed_chats = [
                chat_id
                for chat_id, preview in new_snapshot.items()
                if chat_id in old_snapshot and old_snapshot[chat_id] != preview
            ]

            # Update snapshot immediately
            old_snapshot = new_snapshot

            if not changed_chats:
                continue

            # 6. Process each changed chat
            for chat_id in changed_chats:
                db = SessionLocal()
                settings = db.query(ChatSettings).filter(
                    ChatSettings.chat_id == chat_id
                ).first()
                is_tracked = settings.enabled if settings else False
                db.close()

                has_chat_viewer = manager.is_active(chat_id)

                # Skip if nobody cares
                if not has_chat_viewer and not is_tracked:
                    continue

                # 7. Open chat & scrape
                history = await self.get_chat_history(chat_id=chat_id, limit=50)
                if not history:
                    continue

                # 8. Broadcast immediately
                await manager.broadcast(f"chat_{chat_id}", {
                    "event": "new_message",
                    "text": history[-3:],  # send last few messages
                })

        except Exception as e:
            print(f"⚠️ Listener Error: {e}")
            try:
                await self.page.evaluate(script)
            except:
                pass
