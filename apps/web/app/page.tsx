import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrivalHistory } from "@/features/arrival-history";
import { BacklogProvider } from "@/features/backlog-context";
import { ThemeMenu } from "@/features/theme-menu";
import { DataNotice } from "@/features/data-notice";
import { pageTitle } from "@/features/page-title";
import { listHref } from "@/features/search-href";
import { SearchForm } from "@/features/search-form";
import { ServiceList } from "@/features/service-list";
import { TrainDetail } from "@/features/train-detail";
import { errorText } from "@/server/error-text";
import { parseQuery, timeHhmm, type ParsedQuery } from "@/server/query";
import {
  loadStationDirectory,
  StationDirectoryError,
} from "@/server/station-directory";
import type { Station } from "@/server/stations";
import { trainSource } from "@/server/train-source";
import { searchTrains } from "@/server/use-cases/search-trains";

export const dynamic = "force-dynamic";
/** Next to Neon (eu-west-2). A US region adds an ocean to every database round trip. */
export const preferredRegion = "lhr1";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  try {
    const stations = await loadStationDirectory();
    const query = parseQuery(await searchParams, stations);
    if (query.from && query.to && query.errors.length === 0) {
      return { title: pageTitle(query.from.name, query.to.name) };
    }
  } catch {
    // The page reports a missing station list. The tab keeps the app name.
  }
  return { title: "RailScore" };
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sample = trainSource().sample;
  let stations: readonly Station[];
  try {
    stations = await loadStationDirectory();
  } catch (error) {
    const message =
      error instanceof StationDirectoryError
        ? error.message
        : "The station list could not be loaded.";
    return (
      <>
        <SiteHeader />
        <main>
          <Intro />
          <p className="errors" role="alert">
            {message}
          </p>
        </main>
        <DataNotice sample={sample} />
      </>
    );
  }
  const query = parseQuery(await searchParams, stations);
  const ready = Boolean(query.from && query.to && query.errors.length === 0);
  return (
    <>
      <SiteHeader />
      <main>
        {ready ? null : <Intro />}
        {sample ? (
          <p className="sample" role="status">
            Sample data: these trains and figures are made up so the screens can
            be tried before the official feed is connected.
          </p>
        ) : null}
        <SearchForm
          key={[
            query.fromText,
            query.toText,
            query.time,
            query.days,
            query.period,
          ].join("|")}
          query={query}
          collapsed={ready}
          stations={stations}
        />
        {ready ? (
          <Suspense
            key={panelKey(query)}
            fallback={
              <p className="meta" role="status">
                {query.calculate
                  ? "Checking this train's recent journeys…"
                  : "Finding trains…"}
              </p>
            }
          >
            <TrainPanel query={query} stations={stations} />
          </Suspense>
        ) : null}
      </main>
      <DataNotice sample={sample} />
    </>
  );
}

async function TrainPanel({
  query,
  stations,
}: {
  query: ParsedQuery;
  stations: readonly Station[];
}) {
  if (!query.from || !query.to) {
    return null;
  }
  try {
    const view = await searchTrains({
      fromCrs: query.from.crs,
      toCrs: query.to.crs,
      timeHhmm: timeHhmm(query.time),
      days: query.days,
      periodDays: query.period,
      ...(query.serviceKey ? { serviceKey: query.serviceKey } : {}),
      calculate: query.calculate,
    });
    const trains = (
      <ServiceList
        query={query}
        services={view.services}
        retired={view.retired}
        listed={view.period}
        earlier={view.earlier}
        later={view.later}
        stations={stations}
      />
    );
    const history = view.history;

    return (
      <BacklogProvider request={view.backlog}>
        {view.notice === "train-not-found" ? (
          <p className="warning" role="status">
            That service was not in the historical results for this search.
          </p>
        ) : null}
        {view.notice === "choose-train" ? (
          <p className="warning" role="status">
            Choose a train.
          </p>
        ) : null}
        {history ? (
          <TrainDetail
            href={listHref(query)}
            result={
              <ArrivalHistory
                service={history.service}
                fromCrs={query.from.crs}
                toCrs={query.to.crs}
                period={view.period}
                {...(history.hspDays ? { hspDays: history.hspDays } : {})}
                darwinRuns={history.darwinRuns}
                result={history.result}
                stations={stations}
                days={query.days}
              />
            }
            trains={trains}
          />
        ) : (
          trains
        )}
      </BacklogProvider>
    );
  } catch (error) {
    console.error("The search failed", errorText(error));
    return (
      <p className="errors" role="alert">
        Something went wrong. Try again.
      </p>
    );
  }
}

function SiteHeader() {
  return (
    <header className="site-header">
      <div className="header-bar">
        <Link href="/" className="brand">
          RailScore
        </Link>
        <ThemeMenu />
      </div>
    </header>
  );
}

function Intro() {
  return (
    <header className="intro">
      <h1>How reliable is your train?</h1>
      <p className="lede">
        See how often a train has arrived on time on its recent journeys.
      </p>
    </header>
  );
}

function panelKey(query: ParsedQuery): string {
  return [
    query.fromText,
    query.toText,
    query.time,
    query.days,
    query.period,
    query.serviceKey,
    query.calculate,
  ].join("|");
}
