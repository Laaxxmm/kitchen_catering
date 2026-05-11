import * as React from "react";
import { PageHeader as IkPageHeader } from "@/components/ik";

// Thin shim — forwards to the IK PageHeader so every page that already imports
// `@/components/ui/page-header` inherits the Fresh basil editorial look.
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <IkPageHeader
      eyebrow={eyebrow}
      title={title}
      description={description}
      actions={actions}
    />
  );
}
