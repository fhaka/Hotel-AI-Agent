import type { Metadata } from "next";
import { sendPasswordResetLink, updateProfile } from "@/app/dashboard/settings/actions";
import { signOut } from "@/app/auth/actions";
import { PasswordResetForm, ProfileForm } from "@/components/app/account-forms";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const user = await requireUser("/dashboard/settings");
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("full_name, email").eq("id", user.id).single();

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
      <Card className="space-y-4 p-6">
        <h2 className="text-base font-semibold">Profile</h2>
        <p className="text-sm text-muted">
          Signed in as <span className="font-medium text-ink">{profile?.email ?? user.email}</span>
        </p>
        <ProfileForm action={updateProfile} fullName={profile?.full_name ?? ""} />
      </Card>
      <Card className="space-y-4 p-6">
        <h2 className="text-base font-semibold">Password</h2>
        <p className="text-sm text-muted">For your security, password changes are confirmed through a link sent to your email.</p>
        <PasswordResetForm action={sendPasswordResetLink} />
      </Card>
      <Card className="space-y-4 p-6">
        <h2 className="text-base font-semibold">Sign out</h2>
        <form action={signOut}>
          <Button type="submit" variant="secondary">
            Sign out of this device
          </Button>
        </form>
      </Card>
    </div>
  );
}
