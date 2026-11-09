import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useAction } from '../hooks/useApi';
import {
  EXAMPLE_PROMPTS,
  parseTargetCount,
  startRun,
} from '../services/leadFinder';
import { BusyButton, Field, PageHeader } from '../components/Common';
import { Button } from '../components/ui/button';

const RUNS_KEY = '/lead-finder/runs';

export default function GoogleSearchNew() {
  const navigate = useNavigate();
  const [instruction, setInstruction] = useState('');
  const [targetCount, setTargetCount] = useState('');

  const start = useAction(startRun, null, {
    invalidatePrefixes: [RUNS_KEY],
    onSuccess: (data) => {
      toast.success('Search started');
      navigate(`/lead-finder/gmail/${data.id}`);
    },
  });

  const submit = (event) => {
    event.preventDefault();
    if (instruction.trim().length < 3) return;
    start.mutate({ instruction: instruction.trim(), target_count: parseTargetCount(targetCount) });
  };

  return (
    <>
      <PageHeader
        eyebrow="OUTREACH INTELLIGENCE"
        title="New Google Search"
        description="Describe who you want to reach. Only publicly listed business emails are collected."
        backTo="/lead-finder/gmail"
        backLabel="Back to searches"
      />

      <section className="panel lead-search-compose">
        <form className="lead-search-compose-form" onSubmit={submit}>
          <Field label="Who are you looking for?" required>
            <textarea
              rows={5}
              maxLength={4000}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="e.g. Find 20 technical recruiters in Berlin hiring backend engineers"
            />
          </Field>

          <div className="lead-search-meta">
            <Field label="Target leads">
              <input
                type="number"
                min={1}
                max={100}
                inputMode="numeric"
                value={targetCount}
                onChange={(event) => setTargetCount(event.target.value)}
                placeholder="20"
              />
            </Field>
          </div>

          <div className="lead-examples">
            <p className="lead-examples-label">Try an example</p>
            <div className="lead-examples-list">
              {EXAMPLE_PROMPTS.map((prompt) => (
                <Button
                  key={prompt}
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setInstruction(prompt)}
                >
                  <Sparkles size={14} /> {prompt}
                </Button>
              ))}
            </div>
          </div>

          <div className="lead-search-actions">
            <BusyButton type="submit" busy={start.isPending} disabled={instruction.trim().length < 3}>
              <Search size={16} /> Find leads
            </BusyButton>
          </div>
        </form>
      </section>
    </>
  );
}
