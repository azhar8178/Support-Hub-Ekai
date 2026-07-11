import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useGetPublicBranding } from "@workspace/api-client-react";

export default function LandingPage() {
  const { data: branding } = useGetPublicBranding();
  const companyName = branding?.companyName || "Ekai Support";

  return (
    <div className="flex flex-col min-h-screen bg-stone-50 font-sans text-[#0F1F3D]">
      <header className="px-6 h-16 flex items-center border-b border-stone-200 bg-white">
        <div className="flex items-center gap-2">
          {branding?.logoUrl ? (
            <img src={branding.logoUrl} alt={companyName} className="h-8 max-w-[160px] object-contain" />
          ) : (
            <>
              <img src="/logo.svg" alt="Ekai.ai Logo" className="w-8 h-8" />
              <span className="font-bold text-lg tracking-tight">{companyName}</span>
            </>
          )}
        </div>
        <div className="ml-auto">
          <Link href="/sign-in" className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 h-10 px-4 py-2 bg-[#0F1F3D] text-white hover:bg-[#0F1F3D]/90">
            Sign In
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-20 text-center">
        <div className="mb-6 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-sm text-amber-700">
          <span className="flex h-2 w-2 rounded-full bg-amber-600 mr-2"></span>
          Enterprise Support Portal
        </div>
        <h1 className="max-w-3xl text-5xl font-bold tracking-tight text-[#0F1F3D] sm:text-6xl mb-6">
          Precise, trustworthy <span className="text-[#B45309]">support</span> for your data platforms.
        </h1>
        <p className="max-w-[600px] text-lg text-stone-600 mb-10">
          Access the Ekai knowledge base, track resolution progress, and coordinate with our engineering team directly on infrastructure incidents.
        </p>
        <div className="flex items-center gap-4">
          <Link href="/sign-in" className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors h-11 px-8 bg-[#EFB323] text-[#0F1F3D] hover:bg-[#D69E1E] shadow-sm">
            Sign in to Portal
          </Link>
        </div>
        <p className="mt-6 text-sm text-stone-500">
          Access is by invitation only. Contact your Ekai representative.
        </p>

        <div className="mt-20 max-w-5xl grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
          <div className="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm">
            <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-[#EFB323]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h3 className="font-semibold text-lg mb-2">Priority Resolution</h3>
            <p className="text-stone-600 text-sm">Clear SLA tracking and immediate routing to specialized data engineers for P1/P2 incidents.</p>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm">
            <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h3 className="font-semibold text-lg mb-2">Platform Visibility</h3>
            <p className="text-stone-600 text-sm">Full context tracking across AWS, Azure, GCP, and Snowflake environments.</p>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm">
            <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <h3 className="font-semibold text-lg mb-2">Knowledge Base</h3>
            <p className="text-stone-600 text-sm">Access curated deployment guides, troubleshooting playbooks, and release notes.</p>
          </div>
        </div>
      </main>
      
      <footer className="border-t border-stone-200 bg-white py-8 px-6 text-center text-sm text-stone-500">
        <p>&copy; {new Date().getFullYear()} Ekai.ai. All rights reserved.</p>
      </footer>
    </div>
  );
}
