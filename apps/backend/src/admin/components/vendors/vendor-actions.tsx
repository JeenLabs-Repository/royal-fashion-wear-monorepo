import { Alert, Button, toast, usePrompt } from "@medusajs/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  type VendorDetail,
  activateVendor,
  errorMessage,
  reactivateVendor,
  resendInvite,
  suspendVendor,
  vendorKeys,
} from "../../lib/vendors-api";
import { ReasonPrompt } from "./reason-prompt";

type Props = { vendor: VendorDetail; canManage: boolean };

const SUSPEND_EFFECT =
  "The vendor loses access on their next request and their locations stop counting as available.";
const REACTIVATE_EFFECT = "The vendor regains access and their locations are linked again.";

export const VendorActions = ({ vendor, canManage }: Props) => {
  const queryClient = useQueryClient();
  const prompt = usePrompt();
  const [error, setError] = useState<string | null>(null);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: vendorKeys.all });

  const fail = (failure: unknown) => {
    const message = errorMessage(failure);
    setError(message);
    toast.error(message);
  };

  const resend = useMutation({
    mutationFn: () => resendInvite(vendor.id),
    onSuccess: async (result) => {
      setError(null);
      if (result.invite.email_sent) {
        toast.success(`Invitation sent to ${vendor.contact_email}`);
      } else {
        toast.warning("A new link was created, but the email could not be sent.");
      }
      await refresh();
    },
    onError: fail,
  });

  const activate = useMutation({
    mutationFn: () => activateVendor(vendor.id),
    onSuccess: async () => {
      setError(null);
      toast.success("Vendor activated");
      await refresh();
    },
    onError: fail,
  });

  const suspend = useMutation({
    mutationFn: (reason: string) => suspendVendor(vendor.id, reason),
    onSuccess: async () => {
      setError(null);
      setSuspendOpen(false);
      toast.success("Vendor suspended");
      await refresh();
    },
    onError: fail,
  });

  const reactivate = useMutation({
    mutationFn: (reason: string) => reactivateVendor(vendor.id, reason),
    onSuccess: async () => {
      setError(null);
      setReactivateOpen(false);
      toast.success("Vendor reactivated");
      await refresh();
    },
    onError: fail,
  });

  const confirmResend = async () => {
    const confirmed = await prompt({
      title: "Resend invite",
      description: "Resend creates a new link and cancels the old one.",
      confirmText: "Resend invite",
      cancelText: "Cancel",
    });
    if (confirmed) {
      resend.mutate();
    }
  };

  const confirmActivate = async () => {
    const confirmed = await prompt({
      title: "Activate vendor",
      description:
        "Activating lets the vendor list products once the catalog is open. Locations become sellable.",
      confirmText: "Activate",
      cancelText: "Cancel",
    });
    if (confirmed) {
      activate.mutate();
    }
  };

  const registered = vendor.user?.registered ?? false;
  const title = canManage ? undefined : "Your role cannot change vendors.";
  const busy = resend.isPending || activate.isPending;

  return (
    <div className="flex flex-col gap-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {vendor.status === "invited" && !registered && (
          <Button
            size="small"
            variant="secondary"
            disabled={!canManage || busy}
            title={title}
            onClick={() => void confirmResend()}
            data-testid="action-resend"
          >
            Resend invite
          </Button>
        )}
        {vendor.status === "invited" && (
          <Button
            size="small"
            disabled={!canManage || busy}
            title={title}
            onClick={() => void confirmActivate()}
            data-testid="action-activate"
          >
            Activate
          </Button>
        )}
        {(vendor.status === "active" || vendor.status === "invited") && (
          <Button
            size="small"
            variant="danger"
            disabled={!canManage || busy}
            title={title}
            onClick={() => setSuspendOpen(true)}
            data-testid="action-suspend"
          >
            Suspend
          </Button>
        )}
        {vendor.status === "suspended" && (
          <Button
            size="small"
            disabled={!canManage || busy}
            title={title}
            onClick={() => setReactivateOpen(true)}
            data-testid="action-reactivate"
          >
            Reactivate
          </Button>
        )}
      </div>

      {error && (
        <div data-testid="vendor-action-error">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      <ReasonPrompt
        open={suspendOpen}
        onOpenChange={(open) => {
          setSuspendOpen(open);
          if (!open) setError(null);
        }}
        title="Suspend vendor"
        description={SUSPEND_EFFECT}
        confirmText="Suspend"
        isPending={suspend.isPending}
        serverError={suspendOpen ? error : null}
        onConfirm={(reason) => suspend.mutate(reason)}
      />
      <ReasonPrompt
        open={reactivateOpen}
        onOpenChange={(open) => {
          setReactivateOpen(open);
          if (!open) setError(null);
        }}
        title="Reactivate vendor"
        description={REACTIVATE_EFFECT}
        confirmText="Reactivate"
        isPending={reactivate.isPending}
        serverError={reactivateOpen ? error : null}
        onConfirm={(reason) => reactivate.mutate(reason)}
      />
    </div>
  );
};
