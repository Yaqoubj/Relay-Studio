export const toolboxTools = [
  { id: 'image-smaller', title: 'Make pictures smaller', category: 'Images', description: 'Create smaller copies for sharing.', accepts: 'image' },
  { id: 'image-resize', title: 'Resize pictures', category: 'Images', description: 'Fit pictures to a chosen width.', accepts: 'image' },
  { id: 'image-convert', title: 'Convert pictures', category: 'Images', description: 'Make JPG, PNG, or WebP copies.', accepts: 'image' },
  { id: 'pdf-from-images', title: 'Create a PDF from pictures', category: 'PDFs', description: 'Put pictures into one PDF in your chosen order.', accepts: 'image' },
  { id: 'pdf-merge', title: 'Merge PDFs', category: 'PDFs', description: 'Combine documents in your chosen order.', accepts: 'pdf' },
  { id: 'pdf-extract', title: 'Extract PDF pages', category: 'PDFs', description: 'Save selected pages as a new PDF.', accepts: 'pdf' },
  { id: 'text-extract', title: 'Get text from a file', category: 'Text', description: 'Read text from a PDF, document, or image.', accepts: 'document' },
  { id: 'text-clean', title: 'Clean pasted text', category: 'Text', description: 'Remove extra spacing and broken line wraps.', accepts: 'text' },
] as const;

export type ToolboxToolId = (typeof toolboxTools)[number]['id'];
export type ToolboxInput = {
  id: ToolboxToolId;
  paths: string[];
  text?: string;
  width?: number;
  format?: 'jpeg' | 'png' | 'webp';
  pages?: string;
};
export type ToolboxOutput = { path: string; source?: string; bytes: number };
export type ToolboxResult = {
  id: string;
  tool: ToolboxToolId;
  createdAt: string;
  outputs: ToolboxOutput[];
  text?: string;
  inputBytes?: number;
  errors: string[];
};
export type ToolboxProgress = { completed: number; total: number; label: string };
