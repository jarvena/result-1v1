import { useEffect, useState } from 'react'
import resultsService from './services/results'
import enStrings from './i18n/en.json'
import fiStrings from './i18n/fi.json'
import './App.css'

import { Autocomplete, TextField } from '@mui/material'

const currentYear = new Date().getFullYear()
const yearOptions = Array.from({ length: currentYear - 2010 + 1 }, (_, index) => String(2010 + index))

const localeStrings = {
  fi: fiStrings,
  en: enStrings
}

const normalizeEventList = (data) => {
  console.log('events', data)
  if (!data) return []
  if (Array.isArray(data)) {
    return data.map((item) => ({
      id: item.EventID, // || item.id || item.eventId,
      name: item.EventTitle // || item.EventName || item.NameFi || item.name || item.Description || item.Title || `${item.ID}`
    }))
  }

  const candidates = data.data || data.events || []
  if (Array.isArray(candidates)) {
    return candidates.filter((event) => event.Discipline === 'Orienteering' && event.AllowFollowAll === true && event.EventType === 'Individual').map((item) => ({
      id: item.EventID, // || item.id || item.eventId,
      name: item.EventTitle // || item.EventName || item.NameFi || item.name || item.Description || item.Title || `${item.ID}`
    }))
  }

  return []
}

const normalizeCompetitors = (data) => {
  console.log('competitors', data)
  const list = data?.Competitors // || data?.competitors || data?.Items || data?.items || data || []
  if (!Array.isArray(list)) return []
  return list.map((item) => ({
    id: item[0],
    bib: item[3],
    name:
      `${item[8] || ''} ${item[7] || ''}`.trim()
  }))
}

const getSplitTotalTime = (splits) => {
  if (!Array.isArray(splits) || !splits.length) return undefined
  const lastSplit = splits[splits.length - 1]
  return Array.isArray(lastSplit) ? lastSplit[6] : undefined
}

const getSplitRank = (splits) => {
  if (!Array.isArray(splits) || !splits.length) return undefined
  const lastSplit = splits[splits.length - 1]
  return Array.isArray(lastSplit) ? lastSplit[8] : undefined
}

const normalizeResults = (data) => {
  console.log('results', data)
  const results = data?.Results || data?.results || data?.CompetitorResults || data?.items || data || []
  const list = results.flatMap((competitionClass) => {
    return competitionClass?.Splits?.map((result, index) => ({
      raceNo: competitionClass.RaceNo,
      classId: competitionClass.ClassID,
      bib: competitionClass.Results.find((res) => res[0] === result[0])?.[9],
      runnerId: result[0],
      splits: result[1],
      TotalTime: getSplitTotalTime(result[1]),
      Rank: getSplitRank(result[1])
    }))
  })
  return Array.isArray(list) ? list : []
}

const getValue = (item, keys) => keys.reduce((value, key) => value ?? item?.[key], undefined)

const formatTime = (value) => {
  if (value == null || value === '') return '-'
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.includes(':')) return trimmed
    const parsed = Number(trimmed)
    if (!Number.isNaN(parsed)) value = parsed
    else return trimmed
  }
  if (typeof value === 'number') {
    const totalSeconds = Math.round(value)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    const formatted = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    return hours ? `${hours}:${formatted}` : formatted
  }
  return String(value)
}

const getSplitSectors = (splits) => {
  if (!Array.isArray(splits)) return []

  const sectors = []
  let previousPointId = 'start'

  for (const entry of splits) {
    if (!Array.isArray(entry) || entry.length < 3) continue
    const currentPointId = entry[0]
    const sectorTime = entry[2]
    sectors.push({ from: previousPointId, to: currentPointId, id: currentPointId, sectorTime })
    previousPointId = currentPointId
  }

  return sectors
}

const getSharedSplitSectors = (splitsA, splitsB) => {
  const sectorsA = getSplitSectors(splitsA)
  const sectorsB = getSplitSectors(splitsB)

  const toKey = (sector) => `${sector.from}:${sector.to}`
  const sectorsBByKey = sectorsB.reduce((acc, sector) => {
    const key = toKey(sector)
    if (!acc[key]) acc[key] = []
    acc[key].push(sector)
    return acc
  }, {})

  return sectorsA
    .map((sectorA) => {
      const key = toKey(sectorA)
      const matchingList = sectorsBByKey[key]
      if (!matchingList || !matchingList.length) return null
      const sectorB = matchingList.shift()
      return {
        id: sectorA.id,
        timeA: sectorA.sectorTime,
        timeB: sectorB.sectorTime
      }
    })
    .filter(Boolean)
}

const SplitCumulativeDifferenceLine = ({ sharedSplits, texts }) => {
  if (!sharedSplits?.length) return null

  let cumulativeDiff = 0
  const lineData = [{ x: 0, y: 0, label: texts.startLabel }]
  let yPos = 0

  sharedSplits.forEach((split) => {
    const splitA = Number(split.timeA)
    const splitB = Number(split.timeB)

    if (Number.isFinite(splitA) && Number.isFinite(splitB)) {
      cumulativeDiff += splitA - splitB
      const fasterTime = Math.min(splitA, splitB)
      yPos += fasterTime
      lineData.push({ x: cumulativeDiff, y: yPos, label: String(split.id) })
    }
  })

  const padding = 40
  const graphWidth = 300
  const graphHeight = 600
  const maxY = Math.max(...lineData.map((d) => d.y), 1)
  const minX = Math.min(...lineData.map((d) => d.x), 0)
  const maxX = Math.max(...lineData.map((d) => d.x), 0)
  const xRange = Math.max(Math.abs(minX), Math.abs(maxX), 1)

  const scaleX = graphWidth / (xRange * 2)
  const scaleY = graphHeight / maxY
  const centerX = padding + graphWidth / 2

  const points = lineData.map((d) => ({
    ...d,
    px: centerX + d.x * scaleX,
    py: padding + d.y * scaleY
  }))

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.px} ${p.py}`).join(' ')

  return (
    <div className="split-cumulative-line">
      <h3>{texts.cumulativeDifferenceProgression}</h3>
      <svg width={graphWidth + padding * 2} height={graphHeight + padding * 2} className="line-chart-svg">
        {/* Grid and axes */}
        <line x1={centerX} y1={padding} x2={centerX} y2={graphHeight + padding} stroke="#e5e7eb" strokeWidth="1" />
        <line x1={padding} y1={graphHeight + padding} x2={graphWidth + padding} y2={graphHeight + padding} stroke="#333" strokeWidth="2" />
        <line x1={padding} y1={padding} x2={padding} y2={graphHeight + padding} stroke="#333" strokeWidth="2" />

        {/* Zero line label */}
        <text x={centerX + 4} y={graphHeight + padding + 16} textAnchor="start" fontSize="11" fill="#666">
          {texts.zeroLabel}
        </text>

        {/* Line path */}
        <path d={pathD} stroke="#3b82f6" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />

        {/* Data points */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.px} cy={p.py} r="4" fill="#3b82f6" stroke="#fff" strokeWidth="2" />
            <text x={p.px - 12} y={p.py + 4} textAnchor="end" fontSize="11" fill="#333" fontWeight="600">
              {p.label}
            </text>
            <text x={p.px} y={p.py + 16} textAnchor="middle" fontSize="11" fill="#666">
              {formatTime(Math.abs(p.x))}
            </text>
          </g>
        ))}

        {/* X-axis labels */}
        <text x={padding - 8} y={graphHeight + padding + 4} textAnchor="end" fontSize="11" fill="#666">
          -{formatTime(xRange)}
        </text>
        <text x={graphWidth + padding + 8} y={graphHeight + padding + 4} textAnchor="start" fontSize="11" fill="#666">
          +{formatTime(xRange)}
        </text>

        {/* Y-axis start/end labels */}
        <text x={padding - 8} y={padding + 8} textAnchor="end" fontSize="11" fill="#666">
          {texts.startLabel}
        </text>
        <text x={padding - 8} y={graphHeight + padding} textAnchor="end" fontSize="11" fill="#666">
          {texts.endLabel}
        </text>
      </svg>
    </div>
  )
}

const SplitDifferenceChart = ({ sharedSplits, texts }) => {
  if (!sharedSplits?.length) return null

  const chartData = sharedSplits.map((split) => {
    const splitA = Number(split.timeA)
    const splitB = Number(split.timeB)
    const diff = Number.isFinite(splitA) && Number.isFinite(splitB) ? splitA - splitB : 0
    return {
      id: split.id,
      diff
    }
  })

  const maxAbsDiff = Math.max(...chartData.map((d) => Math.abs(d.diff)), 1)
  const scale = 100 / maxAbsDiff
  const barHeight = 32
  const labelWidth = 50
  const chartWidth = 400
  const centerX = labelWidth + chartWidth / 2

  return (
    <div className="split-difference-chart">
      <h3>{texts.timeDifferenceBySector}</h3>
      <svg width={labelWidth + chartWidth + 20} height={chartData.length * barHeight + 40} className="chart-svg">
        {/* Center line */}
        <line x1={centerX} y1={20} x2={centerX} y2={chartData.length * barHeight + 20} stroke="#ccc" strokeWidth="2" />

        {/* Bars and labels */}
        {chartData.map((item, index) => {
          const y = 20 + index * barHeight + barHeight / 2
          const barWidth = Math.abs(item.diff) * scale
          const isNegative = item.diff < 0

          return (
            <g key={item.id}>
              {/* Label */}
              <text x={labelWidth - 8} y={y + 5} textAnchor="end" fontSize="12" fill="#666">
                {String(item.id)}
              </text>

              {/* Bar */}
              <rect
                x={isNegative ? centerX - barWidth : centerX}
                y={y - 6}
                width={barWidth}
                height={12}
                fill={isNegative ? '#22c55e' : '#ef4444'}
                rx="2"
              />

              {/* Time label */}
              <text
                x={centerX + (isNegative ? -barWidth - 6 : barWidth + 6)}
                y={y + 4}
                textAnchor={isNegative ? 'end' : 'start'}
                fontSize="11"
                fill="#666"
              >
                {formatTime(Math.abs(item.diff))}
              </text>
            </g>
          )
        })}

        {/* Center label */}
        <text x={centerX} y={chartData.length * barHeight + 35} textAnchor="middle" fontSize="12" fill="#999">
          0
        </text>
      </svg>
    </div>
  )
}

const SplitComparisonTable = ({ participantAName, participantBName, sharedSplits, timeDisplayMode, viewMode, texts, participantASplits }) => {
  if (!sharedSplits?.length) {
    return <p className="status-message">{texts.noSharedSplits}</p>
  }

  // Create mapping of split id to index based on participantA's split order
  const sectorIndexMap = {}
  if (participantASplits && Array.isArray(participantASplits)) {
    participantASplits.forEach((entry, index) => {
      if (Array.isArray(entry) && entry.length >= 1) {
        sectorIndexMap[entry[0]] = index + 1
      }
    })
  }

  let cumulativeA = 0
  let cumulativeB = 0
  let cumulativeDiff = 0
  const splitsWithCumulative = sharedSplits.map((split) => {
    const timeA = Number(split.timeA)
    const timeB = Number(split.timeB)
    const validA = Number.isFinite(timeA)
    const validB = Number.isFinite(timeB)
    const splitA = validA ? timeA : null
    const splitB = validB ? timeB : null
    const cumulativeAValue = validA ? cumulativeA + timeA : null
    const cumulativeBValue = validB ? cumulativeB + timeB : null

    if (validA) cumulativeA += timeA
    if (validB) cumulativeB += timeB
    if (validA && validB) cumulativeDiff += timeA - timeB

    return {
      ...split,
      timeA: splitA,
      timeB: splitB,
      cumulativeA: Number.isFinite(cumulativeAValue) ? cumulativeAValue : null,
      cumulativeB: Number.isFinite(cumulativeBValue) ? cumulativeBValue : null,
      cumulativeDiff: Number.isFinite(cumulativeDiff) ? cumulativeDiff : null
    }
  })

  return (
    <div className="split-comparison-section">
      <h3>{texts.sharedSplitComparison}</h3>
      {viewMode === 'table' && (
      <table className="shared-splits-table">
        <thead>
          <tr>
            <th>{texts.sectorIndex}</th>
            <th>{texts.splitPoint}</th>
            <th>{participantAName}</th>
            <th>{participantBName}</th>
            <th>{texts.difference}</th>
            <th>{texts.cumulative}</th>
          </tr>
        </thead>
        <tbody>
          {splitsWithCumulative.map((split) => {
            const displayA = timeDisplayMode === 'cumulative' ? split.cumulativeA : split.timeA
            const displayB = timeDisplayMode === 'cumulative' ? split.cumulativeB : split.timeB
            const splitA = Number(split.timeA)
            const splitB = Number(split.timeB)
            const diff = Number.isFinite(splitA) && Number.isFinite(splitB)
              ? Math.abs(splitA - splitB)
              : null
            const differenceClass = Number.isFinite(splitA) && Number.isFinite(splitB)
              ? splitA < splitB
                ? 'difference-cell faster-a'
                : splitA > splitB
                  ? 'difference-cell faster-b'
                  : 'difference-cell'
              : 'difference-cell'

            const cumulativeDiffValue = split.cumulativeDiff
            const cumulativeClass = Number.isFinite(cumulativeDiffValue)
              ? cumulativeDiffValue < 0
                ? 'difference-cell faster-a'
                : cumulativeDiffValue > 0
                  ? 'difference-cell faster-b'
                  : 'difference-cell'
              : 'difference-cell'

            return (
              <tr key={split.id}>
                <td>{sectorIndexMap[split.id] || '-'}</td>
                <td>{String(split.id)}</td>
                <td>{formatTime(displayA)}</td>
                <td>{formatTime(displayB)}</td>
                <td className={differenceClass}>{formatTime(diff)}</td>
                <td className={cumulativeClass}>{formatTime(Math.abs(cumulativeDiffValue ?? 0))}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      )}
      {viewMode === 'bar' && <SplitDifferenceChart sharedSplits={sharedSplits} texts={texts} />}
      {viewMode === 'line' && <SplitCumulativeDifferenceLine sharedSplits={sharedSplits} texts={texts} />}
    </div>
  )
}

const findParticipantResult = (participantId, results) => {
  if (!participantId || !results?.length) return undefined
  return results.find((result) => {
    const bib = getValue(result, ['runnerId']) // 'Bib', 'ID', 'BaseBib', 'CompetitorID', 'BibNumber', 'bib', 'id'])
    return String(bib) === String(participantId)
  })
}

function App() {
  const [year, setYear] = useState(String(currentYear))
  const [eventId, setEventId] = useState('')
  const [events, setEvents] = useState([])
  const [competitors, setCompetitors] = useState([])
  const [results, setResults] = useState([])
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [loadingEventData, setLoadingEventData] = useState(false)
  const [participantA, setParticipantA] = useState('')
  const [participantB, setParticipantB] = useState('')
  const [timeDisplayMode, setTimeDisplayMode] = useState('split')
  const [viewMode, setViewMode] = useState('table')
  const [locale, setLocale] = useState('fi')
  const [error, setError] = useState('')
  const texts = localeStrings[locale]

  useEffect(() => {
    setEventId('')
    setCompetitors([])
    setResults([])
    setParticipantA('')
    setParticipantB('')
    setError('')
    if (!year) {
      setEvents([])
      return
    }

    setLoadingEvents(true)
    resultsService
      .getEvents(year)
      .then((response) => {
        const normalized = normalizeEventList(response?.data)
        if (normalized.length) {
          setEvents(normalized)
        } else {
          setEvents(sampleEventsByYear[year] || [])
        }
      })
      .catch(() => {
        setEvents(sampleEventsByYear[year] || [])
      })
      .finally(() => setLoadingEvents(false))
  }, [year])

  useEffect(() => {
    if (!eventId) {
      setCompetitors([])
      setResults([])
      setParticipantA('')
      setParticipantB('')
      return
    }

    setLoadingEventData(true)
    setError('')
    Promise.all([
      resultsService.getCompetitors(eventId),
      resultsService.getResults(eventId)
    ])
      .then(([competitorResponse, resultResponse]) => {
        const normalizedCompetitors = normalizeCompetitors(competitorResponse?.data)
        const normalizedResults = normalizeResults(resultResponse?.data)
        setCompetitors(normalizedCompetitors)
        setResults(normalizedResults)
      })
      .catch(() => {
        setError(localeStrings[locale].unableToLoad)
      })
      .finally(() => setLoadingEventData(false))
  }, [eventId, locale])

  const selectedParticipantA = findParticipantResult(participantA, results)
  const selectedParticipantB = findParticipantResult(participantB, results)

  const renderParticipantOption = (participant) => (
    <option key={participant.id} value={participant.id}>
      {participant.name}
    </option>
  )

  const compareTime = () => {
    const timeA = getValue(selectedParticipantA ?? {}, ['TotalTime', 'ResultTime', 'Time', 'TimeSeconds', 'Seconds'])
    const timeB = getValue(selectedParticipantB ?? {}, ['TotalTime', 'ResultTime', 'Time', 'TimeSeconds', 'Seconds'])
    const numericA = Number(timeA)
    const numericB = Number(timeB)
    if (Number.isNaN(numericA) || Number.isNaN(numericB)) return null
    const diff = Math.abs(numericA - numericB)
    return formatTime(diff)
  }

  return (
    <main className="h2h-app">
      <header className="page-header">
        <div className="language-selector">
          <label htmlFor="language-select">{texts.languageLabel}</label>
          <select
            id="language-select"
            value={locale}
            onChange={(event) => setLocale(event.target.value)}
          >
            <option value="fi">{texts.finnish}</option>
            <option value="en">{texts.english}</option>
          </select>
        </div>
        <h1>{texts.pageTitle}</h1>
        <p>{texts.pageDescription}</p>
      </header>

      <section className="selection-panel">
        <div className="field-group">
          <label htmlFor="year-select">{texts.year}</label>
          <select
            id="year-select"
            value={year}
            onChange={(event) => setYear(event.target.value)}
          >
            <option value="">{texts.chooseYear}</option>
            {yearOptions.map((yearOption) => (
              <option key={yearOption} value={yearOption}>
                {yearOption}
              </option>
            ))}
          </select>
        </div>

        <div className="field-group">
          <label htmlFor="event-select">{texts.event}</label>
          <select
            id="event-select"
            value={eventId}
            onChange={(event) => setEventId(event.target.value)}
            disabled={!year || loadingEvents}
          >
            <option value="">
              {loadingEvents ? texts.loadingEvents : year ? texts.chooseEvent : texts.selectYearFirst}
            </option>
            {events.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field-group">
          <Autocomplete
            disablePortal
            onChange={(event, value) => setParticipantA(value?.id)}
            options={competitors.map((competitor) => ({ label: competitor.name, id: competitor.id }))}
            disabled={!eventId || loadingEventData || !competitors.length}
            renderInput={(params) => <TextField {...params} label={texts.participantA} />}
          />
        </div>

        <div className="field-group">
          <Autocomplete
            disablePortal
            onChange={(event, value) => setParticipantB(value?.id)}
            options={competitors.map((competitor) => ({ label: competitor.name, id: competitor.id }))}
            disabled={!eventId || loadingEventData || !competitors.length}
            renderInput={(params) => <TextField {...params} label={texts.participantB} />}
          />
        </div>
      </section>

      {error && <p className="error-message">{error}</p>}

      {loadingEventData && <p className="status-message">{texts.loadingEventData}</p>}

      {participantA && participantB && (
        <section className="comparison-panel">
          <h2>{texts.comparison}</h2>
          <div className="comparison-grid">
            <div className="result-card">
              <h3>{texts.participantA}</h3>
              <p className="result-label">{texts.nameLabel}</p>
              <p>{competitors.find((item) => String(item.id) === String(participantA))?.name || texts.unknown}</p>
              <p className="result-label">{texts.resultLabel}</p>
              <p>{formatTime(getSplitTotalTime(selectedParticipantA?.splits))}</p>
              <p className="result-label">{texts.rankLabel}</p>
              <p>{getValue(selectedParticipantA ?? {}, ['Rank', 'Position', 'Place']) ?? '-'}</p>
            </div>

            <div className="result-card">
              <h3>{texts.participantB}</h3>
              <p className="result-label">{texts.nameLabel}</p>
              <p>{competitors.find((item) => String(item.id) === String(participantB))?.name || texts.unknown}</p>
              <p className="result-label">{texts.resultLabel}</p>
              <p>{formatTime(getSplitTotalTime(selectedParticipantB?.splits))}</p>
              <p className="result-label">{texts.rankLabel}</p>
              <p>{getValue(selectedParticipantB ?? {}, ['Rank', 'Position', 'Place']) ?? '-'}</p>
            </div>
          </div>

          {selectedParticipantA && selectedParticipantB ? (
            <>
              <div className="summary-row">
                <h3>{texts.headToHeadDifference}</h3>
                <p>{compareTime() || texts.comparisonUnavailable}</p>
              </div>
              <div className="display-mode-toggle">
                <label>
                  <input
                    type="radio"
                    name="time-display"
                    value="split"
                    checked={timeDisplayMode === 'split'}
                    onChange={() => setTimeDisplayMode('split')}
                  />
                  {texts.splitTime}
                </label>
                <label>
                  <input
                    type="radio"
                    name="time-display"
                    value="cumulative"
                    checked={timeDisplayMode === 'cumulative'}
                    onChange={() => setTimeDisplayMode('cumulative')}
                  />
                  {texts.cumulativeTime}
                </label>
              </div>
              <div className="view-mode-toggle">
                <label>
                  <input
                    type="radio"
                    name="view-mode"
                    value="table"
                    checked={viewMode === 'table'}
                    onChange={() => setViewMode('table')}
                  />
                  {texts.tableView}
                </label>
                <label>
                  <input
                    type="radio"
                    name="view-mode"
                    value="bar"
                    checked={viewMode === 'bar'}
                    onChange={() => setViewMode('bar')}
                  />
                  {texts.barChart}
                </label>
                <label>
                  <input
                    type="radio"
                    name="view-mode"
                    value="line"
                    checked={viewMode === 'line'}
                    onChange={() => setViewMode('line')}
                  />
                  {texts.lineGraph}
                </label>
              </div>
              <SplitComparisonTable
                participantAName={competitors.find((item) => String(item.id) === String(participantA))?.name || texts.participantA}
                participantBName={competitors.find((item) => String(item.id) === String(participantB))?.name || texts.participantB}
                sharedSplits={getSharedSplitSectors(selectedParticipantA?.splits, selectedParticipantB?.splits)}
                timeDisplayMode={timeDisplayMode}
                viewMode={viewMode}
                texts={texts}
                participantASplits={selectedParticipantA?.splits}
              />
            </>
          ) : (
            <p className="status-message">{texts.resultsNotAvailable}</p>
          )}
        </section>
      )}
    </main>
  )
}

export default App
