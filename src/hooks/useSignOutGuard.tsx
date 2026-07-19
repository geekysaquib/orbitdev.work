import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useSeed } from "../context/Seed";
import { ConfirmModal } from "../components/ConfirmModal";

/**
 * Shared "seeding is still running" sign-out guard — used by both Layout's
 * profile menu and Settings' account section.
 */
export function useSignOutGuard() {
  const { signOut } = useAuth();
  const { activeJob } = useSeed();
  const [confirming, setConfirming] = useState(false);

  function requestSignOut() {
    if (activeJob?.status === "running") setConfirming(true);
    else signOut();
  }

  const signOutGuardModal = confirming ? (
    <ConfirmModal
      title="Seeding is still running"
      message="You're signing out while dummy data is still being seeded into your database. The agent will lose the connection it's using to insert rows, which can interrupt the job partway through and leave tables partially seeded. Continue anyway?"
      confirmLabel="Sign out anyway"
      danger
      onConfirm={() => { setConfirming(false); signOut(); }}
      onCancel={() => setConfirming(false)}
    />
  ) : null;

  return { requestSignOut, signOutGuardModal };
}
