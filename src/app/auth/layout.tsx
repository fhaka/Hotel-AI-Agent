import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: LayoutProps<"/auth">) {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Logo />
      </div>
      <main className="w-full max-w-md">{children}</main>
      <p className="mt-8 text-center text-xs text-subtle">
        Secure sign-in powered by Supabase Auth. We never share your credentials.
      </p>
    </div>
  );
}
