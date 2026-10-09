// Parsers that turn the different backend response formats into a common entry shape:
// { key, name, label, className, raceNo, splits, TotalTime, Rank }
// where splits are raw OLControl arrays with times in seconds:
// [ControlCode, SplitDistance, SplitTime, SplitDifference, SplitRank, SplitTotalResults,
//  CumulativeTime, CumulativeDifference, CumulativeRank, RelayRank]

const SUPPORTED_EVENT_TYPES = ['Individual', 'Relay', 'MultiRace']
const TIME_INDICES = [2, 3, 6, 7]

export const normalizeEventList = (data) => {
  if (!data) return []
  const list = Array.isArray(data) ? data : data.data || data.events || []
  if (!Array.isArray(list)) return []
  return list
    .filter((event) => event.Discipline === 'Orienteering' && SUPPORTED_EVENT_TYPES.includes(event.EventType))
    .map((item) => ({
      id: item.EventID,
      name: item.EventTitle
    }))
}

export const getEventInfo = (eventData) => {
  const headers = eventData?.Headers || {}
  const races = (eventData?.Races || []).map((race) => ({
    raceNo: race.RaceNo,
    title: race.RaceTitle,
    date: race.RaceDate
  }))
  const raceNos = races.map((race) => race.raceNo)
  const currentRace = raceNos.includes(headers.CurrentRace) ? headers.CurrentRace : raceNos[0]
  const classNames = (eventData?.Classes || []).reduce((acc, competitionClass) => {
    acc[competitionClass.ID] = competitionClass.ClassNameShort || competitionClass.ClassNameLong
    return acc
  }, {})
  return {
    type: headers.EventType,
    followAll: headers.AllowFollowAll === true,
    precision: headers.TimePrecision || 1,
    races,
    currentRace,
    classNames
  }
}

export const getSplitTotalTime = (splits) => {
  if (!Array.isArray(splits) || !splits.length) return undefined
  const lastSplit = splits[splits.length - 1]
  return Array.isArray(lastSplit) ? lastSplit[6] : undefined
}

export const getSplitRank = (splits) => {
  if (!Array.isArray(splits) || !splits.length) return undefined
  const lastSplit = splits[splits.length - 1]
  return Array.isArray(lastSplit) ? lastSplit[8] : undefined
}

export const scaleSplits = (splits, precision = 1) => {
  if (!Array.isArray(splits)) return []
  if (precision === 1) return splits
  return splits.map((entry) => {
    if (!Array.isArray(entry)) return entry
    const scaled = [...entry]
    TIME_INDICES.forEach((index) => {
      if (typeof scaled[index] === 'number') scaled[index] = scaled[index] / precision
    })
    return scaled
  })
}

export const buildLookups = (competitorsData) => {
  const clubs = (competitorsData?.Clubs || []).reduce((acc, club) => {
    acc[club[0]] = club[1]
    return acc
  }, {})
  const competitors = {}
  const competitorsByBaseBib = {}
  ;(competitorsData?.Competitors || []).forEach((competitor) => {
    competitors[competitor[0]] = competitor
    competitorsByBaseBib[competitor[3]] = competitor
  })
  return { clubs, competitors, competitorsByBaseBib }
}

const joinName = (first, last) => `${(first || '').trim()} ${(last || '').trim()}`.trim()

// Relay team row: [CompetitorID, ClubID, Nationality, BaseBib, Races, TeamNo, Bib, ClassID]
const getRelayTeamName = (team, lookups, fallback) => {
  const clubName = lookups.clubs[team?.[1]]
  return clubName ? `${clubName} ${team?.[5] ?? ''}`.trim() : String(fallback ?? team?.[6] ?? '')
}

const getRelayClassName = (className, legText, leg) => `${className ?? ''} ${legText} ${leg}`.trim()

const getRelayLabel = (name, teamName, relayClassName) => `${name} – ${teamName}, ${relayClassName}`.replace(/\s+/g, ' ')

const buildEntry = ({ key, name, label, className, raceNo, splits }) => ({
  key,
  name,
  label,
  className,
  raceNo,
  splits,
  TotalTime: getSplitTotalTime(splits),
  Rank: getSplitRank(splits)
})

// Individual events with AllowFollowAll: online_{id}_results.json
export const parseIndividualResults = (resultsData, lookups, classNames, precision) => {
  const results = resultsData?.Results || []
  return results.flatMap((competitionClass) =>
    (competitionClass?.Splits || [])
      .filter((row) => Array.isArray(row[1]) && row[1].length)
      .map(([runnerId, rawSplits]) => {
        const competitor = lookups.competitors[runnerId]
        const name = joinName(competitor?.[8], competitor?.[7]) || String(runnerId)
        const className = classNames[competitionClass.ClassID]
        return buildEntry({
          key: String(runnerId),
          name,
          label: className ? `${name} (${className})` : name,
          className,
          raceNo: competitionClass.RaceNo,
          splits: scaleSplits(rawSplits, precision)
        })
      })
  )
}

// Relay events: competitors are teams, RaceNo is the leg and runner names are in the Results rows
export const parseRelayResults = (resultsData, lookups, classNames, precision, legText = 'leg') => {
  const results = resultsData?.Results || []
  return results.flatMap((competitionClass) => {
    const resultRows = (competitionClass?.Results || []).reduce((acc, row) => {
      acc[row[0]] = row
      return acc
    }, {})
    const className = classNames[competitionClass.ClassID]
    const leg = competitionClass.RaceNo

    return (competitionClass?.Splits || [])
      .filter((row) => Array.isArray(row[1]) && row[1].length)
      .map(([teamId, rawSplits]) => {
        const team = lookups.competitors[teamId]
        const resultRow = resultRows[teamId]
        const teamName = getRelayTeamName(team, lookups, teamId)
        const name = joinName(resultRow?.[10], resultRow?.[9]) || teamName
        const relayClassName = getRelayClassName(className, legText, leg)
        return buildEntry({
          key: `${leg}:${teamId}`,
          name,
          label: getRelayLabel(name, teamName, relayClassName),
          className: relayClassName,
          raceNo: leg,
          splits: scaleSplits(rawSplits, precision)
        })
      })
  })
}

// Relays without a combined results file: online_{id}_resultlist.json lists every team (RaceNo 0)
// followed by its leg rows. ClassID in the list is unreliable, so the class comes from competitors.json.
// Splits are loaded per team by BaseBib.
export const parseRelayResultList = (resultListData, lookups, classNames, legText = 'leg') => {
  const rows = resultListData?.data || []
  const options = []
  let teamRow = null

  rows.forEach((row) => {
    if (row.RaceNo === 0) {
      teamRow = row
      return
    }
    const name = (row.Name || '').trim()
    if (!teamRow || !name) return

    const baseBib = teamRow.BaseBib
    const team = lookups.competitorsByBaseBib[baseBib]
    const teamName = team ? getRelayTeamName(team, lookups, teamRow.ClubNameLong) : teamRow.ClubNameLong
    const relayClassName = getRelayClassName(classNames[team?.[7]], legText, row.RaceNo)
    options.push({
      id: `${row.RaceNo}:${baseBib}`,
      baseBib,
      leg: row.RaceNo,
      name,
      label: getRelayLabel(name, teamName, relayClassName),
      className: relayClassName
    })
  })

  return options
}

// Participant list for events without a combined results file. Splits are loaded per competitor by BaseBib.
export const parseIndividualCompetitors = (competitorsData, lookups) =>
  (competitorsData?.Competitors || [])
    .map((competitor) => {
      const name = joinName(competitor[8], competitor[7])
      if (!name) return null
      const clubName = lookups.clubs[competitor[1]]
      return {
        id: String(competitor[0]),
        baseBib: competitor[3],
        name,
        label: clubName ? `${name} (${clubName})` : name
      }
    })
    .filter(Boolean)

// Parses display strings such as "1:02:03", "15:29", "45" or "12:20.4" into seconds
export const parseTimeString = (value) => {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(',', '.')
  if (!trimmed || !/^\d+(:\d+){0,2}(\.\d+)?$/.test(trimmed)) return null
  return trimmed.split(':').reduce((total, part) => total * 60 + Number(part), 0)
}

export const parseRank = (value) => {
  if (typeof value === 'number') return value
  const parsed = parseInt(String(value ?? ''), 10)
  return Number.isNaN(parsed) ? null : parsed
}

// Per-competitor response (online_{id}_competitor.json?BaseBib=N). Races is an object keyed by RaceNo
// for individual competitors and an array of legs for relay teams.
export const findCompetitorRace = (details, raceNo) => {
  const races = details?.Races
  if (Array.isArray(races)) return races.find((race) => race.RaceNo === raceNo)
  return races?.[raceNo]
}

// Converts a per-competitor race with formatted split strings into an entry
export const parseCompetitorRace = (race, participant) => {
  if (!race || !Array.isArray(race.Splits) || !race.Splits.length) return undefined

  let previousCumulative = 0
  const splits = race.Splits.map((split) => {
    const cumulative = parseTimeString(split.CumulativeTime)
    let splitTime = parseTimeString(split.SplitTime)
    if (splitTime == null && cumulative != null && previousCumulative != null) {
      splitTime = cumulative - previousCumulative
    }
    previousCumulative = cumulative
    return [
      split.ControlCode,
      null,
      splitTime,
      null,
      parseRank(split.SplitRank),
      0,
      cumulative,
      null,
      parseRank(split.CumulativeRank),
      0
    ]
  })

  const finish = (race.Results || []).find((result) => result.Point === 0)
  return {
    key: participant?.id,
    name: participant?.name || race.Name,
    label: participant?.label,
    className: participant?.className || race.ClassNameShort || race.ClassNameLong,
    raceNo: race.RaceNo,
    splits,
    TotalTime: parseTimeString(finish?.TimeRace) ?? getSplitTotalTime(splits),
    Rank: parseRank(finish?.RankRace) ?? getSplitRank(splits)
  }
}
