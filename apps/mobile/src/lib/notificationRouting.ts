/**
 * Where a tapped notification lands.
 *
 * The scheduler puts `{ run_id, type }` in every push payload, and until this
 * hook existed nothing read it — "Photos from Saturday 6K are up" opened the
 * app on the home screen and left the member to go find the gallery
 * themselves, which quietly defeats the point of sending the notification.
 *
 * Two paths, both handled:
 *   · app already running → the response listener fires;
 *   · app cold-started by the tap → the launch response is read once.
 *
 * The id guard stops the cold-start response being handled twice when the
 * listener also sees it, which happens on Android.
 */

import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';

type PushData = { run_id?: string | null; type?: string | null };

type Destination =
  | { pathname: '/photos/[runId]'; params: { runId: string } }
  | { pathname: '/run/[id]'; params: { id: string } };

function destination(data: PushData): Destination | null {
  if (!data.run_id) return null;
  // Photos land on the gallery itself. Everything else about a run — it
  // dropped, it starts soon, the route is live, a spot opened — lands on the
  // run, which is where all of those answers live.
  if (data.type === 'photos_ready') {
    return { pathname: '/photos/[runId]', params: { runId: data.run_id } };
  }
  return { pathname: '/run/[id]', params: { id: data.run_id } };
}

export function useNotificationRouting(ready: boolean) {
  const router = useRouter();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;

    const open = (response: Notifications.NotificationResponse) => {
      const id = response.notification.request.identifier;
      if (handled.current === id) return;
      handled.current = id;

      const target = destination(
        (response.notification.request.content.data ?? {}) as PushData,
      );
      if (!target) return;
      // Narrowed per variant: spreading the union re-widens it past what the
      // typed router accepts.
      if (target.pathname === '/photos/[runId]') router.push(target);
      else router.push(target);
    };

    // The tap that cold-started the app, if there was one.
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) open(response);
      })
      .catch(() => {
        // Web and simulators have no notification machinery; nothing to route.
      });

    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [ready, router]);
}
