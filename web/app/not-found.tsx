import { Container } from "@/components/ui/Container";
import { ButtonLink } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <main>
      <Container className="flex min-h-[60vh] flex-col items-center justify-center py-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 max-w-sm text-[14.5px] leading-relaxed text-ink-secondary">
          That page doesn&apos;t exist, or the link is out of date.
        </p>
        <ButtonLink href="/" size="lg" className="mt-6">
          Back to GaitSense
        </ButtonLink>
      </Container>
    </main>
  );
}
