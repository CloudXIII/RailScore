import { Suspense } from "react";
import type { Metadata } from "next";
import { BusyRetry } from "@/features/busy-retry";
import { ThemeMenu } from "@/features/theme-menu";
import { CalculationProgress } from "@/features/calculation-progress";
import { ContentReady, WaitGate } from "@/features/wait-gate";
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
import { findServices } from "@/server/find-services";
import { clearCalculationProgress } from "@/server/hsp/calculation-progress";
import { HspRequestError } from "@/server/hsp/client";
import { DailyLimitError } from "@/server/hsp/daily-limit";
import { HspResponseError } from "@/server/hsp/map";
import { parseQuery, timeHhmm, type ParsedQuery } from "@/server/query";
import {
  loadStationDirectory,
  StationDirectoryError,
} from "@/server/station-directory";
import type { Station } from "@/server/stations";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

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
          <WaitGate
            key={panelKey(query)}
            title={
              query.calculate
                ? "Checking this train's recent journeys"
                : "Finding trains"
            }
            detail={
              query.calculate
                ? "The first check can take up to a minute. Leave this tab open."
                : "This usually takes under a minute."
            }
            mode={query.calculate ? "calculation" : "search"}
            periodDays={query.period}
            days={query.days}
            serviceKey={query.calculate ? query.serviceKey : undefined}
          >
            <Suspense fallback={null}>
              <TrainPanel query={query} sample={sample} stations={stations} />
            </Suspense>
          </WaitGate>
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
    return <ContentReady>{null}</ContentReady>;
  }
  if (query.calculate && query.serviceKey) {
    clearCalculationProgress(query.serviceKey);
  }
  try {
    const found = await findServices({
      fromCrs: query.from.crs,
      toCrs: query.to.crs,
      timeHhmm: timeHhmm(query.time),
      days: query.days,
      periodDays: query.period,
      refreshStale: !query.calculate,
    });
    const selected = query.serviceKey
      ? findSelectedService(
          [...found.services, ...found.retired],
          query.serviceKey,
        )
      : undefined;
    const calculation =
      query.calculate && selected
        ? await finishCalculation(
            selected,
            query.from.crs,
            query.to.crs,
            query.serviceKey,
          )
        : undefined;
    const result =
      calculation?.status === "complete" ? calculation.result : undefined;
    const byDay = calculation?.status === "complete" ? calculation.byDay : [];
    const trains = (
      <ServiceList
        query={query}
        services={found.services}
        retired={found.retired}
        listedTo={found.period.to}
        stations={stations}
        sample={sample}
      />
    );

    return (
      <ContentReady>
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
        {calculation?.status === "working" ? (
          <CalculationProgress
            saved={calculation.saved}
            total={calculation.total}
            provisional={calculation.provisional}
            serviceKey={query.serviceKey}
            periodDays={query.period}
            days={query.days}
          />
        ) : result && selected ? (
          <TrainDetail
            href={listHref(query)}
            result={
              <ReliabilityResultView
                service={selected}
                fromCrs={query.from.crs}
                toCrs={query.to.crs}
                period={found.period}
                result={result}
                byDay={byDay}
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
      </ContentReady>
    );
  } catch (error) {
    if (error instanceof HspRequestError && error.kind === "busy") {
      const calculating = query.calculate && Boolean(query.serviceKey);
      return (
        <ContentReady>
          <BusyRetry
            title={
              calculating
                ? "Checking this train's recent journeys"
                : "Finding trains"
            }
            mode={calculating ? "calculation" : "search"}
            periodDays={query.period}
            days={query.days}
            serviceKey={calculating ? query.serviceKey : undefined}
            message={error.message}
          />
        </ContentReady>
      );
    }
    return (
      <ContentReady>
        <p className="errors" role="alert">
          {errorMessage(error)}
        </p>
      </ContentReady>
    );
  }
}

function errorMessage(error: unknown): string {
  if (
    error instanceof HspRequestError ||
    error instanceof HspResponseError ||
    error instanceof DailyLimitError
  ) {
    return error.message;
  }
  return "Something went wrong. Try again.";
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

/**
 * One slice, then the page. A slice that is still working renders the same
 * progress screen as a slow single-call run, and that screen reloads to continue.
 * Staying in this request until every run is stored would hide that screen.
 */
async function finishCalculation(
  service: NonNullable<ReturnType<typeof findSelectedService>>,
  boardingCrs: string,
  destinationCrs: string,
  progressKey: string | undefined,
) {
  return calculateService({
    service,
    boardingCrs,
    destinationCrs,
    progressKey,
  });
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
