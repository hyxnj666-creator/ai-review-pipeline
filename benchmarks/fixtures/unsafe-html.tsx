type Props = {
  html: string;
};

export function UnsafeHtmlPreview({ html }: Props) {
  return (
    <div
      className="prose max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
