import { PageHeader, Empty } from '../components/Common';

export default function LinkedInFinder() {
  return (
    <>
      <PageHeader
        eyebrow="AUDIENCE WORKSPACE"
        title="LinkedIn Search"
        description="Find leads from LinkedIn. This workspace section is ready for the next build."
      />
      <section className="panel">
        <Empty
          title="LinkedIn Search coming next"
          description="This tab is set up. Lead search from LinkedIn will land here."
        />
      </section>
    </>
  );
}
