import { Button, Container, Heading, Input, Label, Text, Textarea, toast } from "@medusajs/ui";
import { useEffect, useState } from "react";
import {
  type ReviewDetail,
  describeError,
  useEditContent,
} from "../../../lib/product-reviews";

type ContentEditorProps = {
  review: ReviewDetail;
  onStale: () => void;
};

const move = (list: string[], from: number, to: number): string[] => {
  if (to < 0 || to >= list.length) {
    return list;
  }
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
};

export const ContentEditor = ({ review, onStale }: ContentEditorProps) => {
  const edit = useEditContent(review.id);
  const original = review.content.images.map((image) => image.upload_id);
  const [title, setTitle] = useState(review.content.title);
  const [description, setDescription] = useState(review.content.description);
  const [order, setOrder] = useState<string[]>(original);
  const [message, setMessage] = useState<string | null>(null);

  // The saved content replaces the form whenever the revision hash changes.
  useEffect(() => {
    setTitle(review.content.title);
    setDescription(review.content.description);
    setOrder(review.content.images.map((image) => image.upload_id));
    setMessage(null);
  }, [review.content_hash]);

  const urlOf = (uploadId: string) =>
    review.content.images.find((image) => image.upload_id === uploadId)?.url ?? null;

  const titleChanged = title !== review.content.title;
  const descriptionChanged = description !== review.content.description;
  const orderChanged = order.join("|") !== original.join("|");
  const dirty = titleChanged || descriptionChanged || orderChanged;
  const titleOk = title.trim().length > 0 && title.length <= 150;

  const save = () => {
    setMessage(null);
    edit.mutate(
      {
        expected_hash: review.content_hash,
        ...(titleChanged ? { title } : {}),
        ...(descriptionChanged ? { description } : {}),
        ...(orderChanged ? { image_upload_ids: order } : {}),
      },
      {
        onSuccess: () => toast.success("Edits saved"),
        onError: (error) => {
          const failure = describeError(error);
          if (failure.stale) {
            onStale();
          } else {
            setMessage(failure.message);
          }
        },
      }
    );
  };

  return (
    <Container className="flex flex-col gap-y-4 px-6 py-4" data-testid="content-editor">
      <div>
        <Heading level="h2">Content edits</Heading>
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          Your next approval is of the edited content. Markup is removed when you save.
        </Text>
      </div>

      <div className="flex flex-col gap-y-1">
        <Label htmlFor="edit-title">Title</Label>
        <Input
          id="edit-title"
          data-testid="edit-title"
          value={title}
          maxLength={150}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-y-1">
        <Label htmlFor="edit-description">Description</Label>
        <Textarea
          id="edit-description"
          data-testid="edit-description"
          rows={6}
          value={description}
          maxLength={5000}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-y-2">
        <Text size="small" leading="compact" weight="plus">
          Image order
        </Text>
        {order.map((uploadId, index) => (
          <div key={uploadId} className="flex items-center gap-x-3">
            <Text size="small" leading="compact" className="w-6">
              {index + 1}
            </Text>
            <Text size="small" leading="compact" className="min-w-0 flex-1 truncate">
              {urlOf(uploadId) ?? uploadId}
            </Text>
            <Button
              size="small"
              variant="secondary"
              disabled={index === 0}
              aria-label={`Move image ${index + 1} up`}
              onClick={() => setOrder(move(order, index, index - 1))}
            >
              Move up
            </Button>
            <Button
              size="small"
              variant="secondary"
              disabled={index === order.length - 1}
              aria-label={`Move image ${index + 1} down`}
              onClick={() => setOrder(move(order, index, index + 1))}
            >
              Move down
            </Button>
          </div>
        ))}
      </div>

      {message ? (
        <Text size="small" leading="compact" className="text-ui-fg-error" role="alert">
          {message}
        </Text>
      ) : null}

      <div>
        <Button
          data-testid="save-edits"
          disabled={!dirty || !titleOk}
          isLoading={edit.isPending}
          onClick={save}
        >
          Save edits
        </Button>
      </div>
    </Container>
  );
};
