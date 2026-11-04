import { Download } from 'lucide-react';
import { Button } from './ui/button';

export function RecipientImportTemplateButton() {
  return (
    <Button asChild>
      <a href="/recipient-import-template.xlsx" download="recipient-import-template.xlsx">
        <Download size={16} />
        Download Excel template
      </a>
    </Button>
  );
}
