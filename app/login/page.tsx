import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-milk">
      <Suspense
        fallback={
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-soft p-8">
            <p className="font-body text-sm text-ink/50">Loading...</p>
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
