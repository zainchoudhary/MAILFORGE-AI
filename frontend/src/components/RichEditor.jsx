import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic, List, ListOrdered, Undo2, Redo2 } from 'lucide-react';
export function RichEditor({ value, onChange }) {
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false } })],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: { attributes: { 'aria-label': 'Email message body', class: 'rich-content' } },
  });
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value || '', { emitUpdate: false });
    }
  }, [value, editor]);
  if (!editor) return null;
  const tools = [
    [Bold, () => editor.chain().focus().toggleBold().run(), 'Bold'],
    [Italic, () => editor.chain().focus().toggleItalic().run(), 'Italic'],
    [List, () => editor.chain().focus().toggleBulletList().run(), 'Bullet list'],
    [ListOrdered, () => editor.chain().focus().toggleOrderedList().run(), 'Numbered list'],
    [Undo2, () => editor.chain().focus().undo().run(), 'Undo'],
    [Redo2, () => editor.chain().focus().redo().run(), 'Redo'],
  ];
  return (
    <div className="rich-editor">
      <div className="editor-toolbar">
        {tools.map(([Icon, action, label]) => (
          <button type="button" key={label} aria-label={label} title={label} onClick={action}>
            <Icon size={16} />
          </button>
        ))}
        <span>Rich text</span>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
export function EmailPreview({ subject, body, recipient }) {
  return (
    <div className="email-preview">
      <div>
        <small>TO</small>
        <span>{recipient || 'Selected recipient'}</span>
      </div>
      <h3>{subject || '(No subject)'}</h3>
      <iframe
        title="Email preview"
        sandbox=""
        srcDoc={`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{font:14px/1.7 Arial;color:#1e293b;padding:12px;overflow-wrap:anywhere}a{color:#2563eb}</style></head><body>${body || '<p>Your email preview will appear here.</p>'}</body></html>`}
      />
    </div>
  );
}
