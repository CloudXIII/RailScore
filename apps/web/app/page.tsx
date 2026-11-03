import { Suspense } from "react";
import type { Metadata } from "next";
import { ThemeMenu } from "@/features/theme-menu";
import { DataNotice } from "@/features/data-notice";
import { pageTitle } from "@/features/page-title";
import { ReliabilityResultView } from "@/features/reliability-result";
import { listHref } from "@/features/search-href";
import { SearchForm } from "@/features/search-form";
import { ServiceList } from "@/features/service-list";
import { TrainDetail } from "@/features/train-detail";
import {
  calculateService,
  findSelectedService,
} from "@/server/calculate-reliability";
import { usesMockData } from "@/server/env";
import { errorText } from "@/server/error-text";
import { findServices } from "@/server/find-services";
import { parseQuery, timeHhmm, type ParsedQuery } from "@/server/query";
import {
  loadStationDirectory,
  StationDirectoryError,
} from "@/server/station-directory";
import type { Station } from "@/server/stations";

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
        <DataNotice sample={usesMockData()} />
      </>
    );
  }
  const query = parseQuery(await searchParams, stations);
  const ready = Boolean(query.from && query.to && query.errors.length === 0);
  const sample = usesMockData();
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
            <TrainPanel query={query} sample={sample} stations={stations} />
          </Suspense>
        ) : null}
      </main>
      <DataNotice sample={sample} />
    </>
  );
}

async function TrainPanel({
  query,
  sample,
  stations,
}: {
  query: ParsedQuery;
  sample: boolean;
  stations: readonly Station[];
}) {
  if (!query.from || !query.to) {
    return null;
  }
  try {
    const found = await findServices({
      fromCrs: query.from.crs,
      toCrs: query.to.crs,
      timeHhmm: timeHhmm(query.time),
      days: query.days,
      periodDays: query.period,
    });
    const selected = query.serviceKey
      ? findSelectedService(
          [...found.services, ...found.retired],
          query.serviceKey,
        )
      : undefined;
    const calculation =
      query.calculate && selected
        ? await calculateService({
            service: selected,
            boardingCrs: query.from.crs,
            destinationCrs: query.to.crs,
          })
        : undefined;
    const trains = (
      <ServiceList
        query={query}
        services={found.services}
        retired={found.retired}
        listed={found.period}
        stations={stations}
        sample={sample}
      />
    );

    return (
      <>
        {query.calculate && query.serviceKey && !selected ? (
          <p className="warning" role="status">
            That service was not in the historical results for this search.
          </p>
        ) : null}
        {query.calculate && !query.serviceKey ? (
          <p className="warning" role="status">
            Choose a train.
          </p>
        ) : null}
        {calculation && selected ? (
          <TrainDetail
            href={listHref(query)}
            result={
              <ReliabilityResultView
                service={selected}
                fromCrs={query.from.crs}
                toCrs={query.to.crs}
                period={found.period}
                result={calculation.result}
                byDay={calculation.byDay}
                stations={stations}
                days={query.days}
                sample={sample}
              />
            }
            trains={trains}
          />
        ) : (
          trains
        )}
      </>
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
        <a href="/" className="brand">
          RailScore
        </a>
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
        See how often a direct train has arrived on time on its recent journeys.
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
