import { Tabs } from 'expo-router';
import { colors } from '@mvmnt/shared';
import {
  BoardIcon,
  HomeIcon,
  PhotosIcon,
  ProfileIcon,
  ShopIcon,
} from '@/components/TabIcons';

/**
 * The bottom tab bar — the app's five rooms.
 *
 * Owner request, 2026-07-29: "a bar at the bottom with different logos to
 * press". Before this, every screen hung off the home screen through chips
 * and links, which worked at three screens and stopped working at ten —
 * the owner published a gallery and could not find it, because "where
 * would photos live?" had no answer a member could guess. A tab bar is that
 * answer: five destinations, always visible, in the order a member wants
 * them on a Saturday.
 *
 * Friends is deliberately NOT a tab: its entry point stays on the home
 * screen. Adding someone is an in-person moment at a run, not a room you
 * hang out in — and a five-tab bar is the most a thumb can tell apart.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.base },
        headerTintColor: colors.textOnDark,
        headerTitleStyle: { fontWeight: '700' },
        sceneStyle: { backgroundColor: colors.base },
        tabBarStyle: {
          backgroundColor: colors.baseElevated,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.action,
        tabBarInactiveTintColor: colors.textOnDarkMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'MVMNT',
          tabBarLabel: 'Home',
          tabBarIcon: ({ color }) => <HomeIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="leaderboard"
        options={{
          title: 'The board',
          tabBarLabel: 'Board',
          tabBarIcon: ({ color }) => <BoardIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="photos"
        options={{
          title: 'Photos',
          tabBarLabel: 'Photos',
          tabBarIcon: ({ color }) => <PhotosIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="shop"
        options={{
          title: 'Shop',
          tabBarLabel: 'Shop',
          tabBarIcon: ({ color }) => <ShopIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarLabel: 'Profile',
          tabBarIcon: ({ color }) => <ProfileIcon color={color} />,
        }}
      />
    </Tabs>
  );
}
