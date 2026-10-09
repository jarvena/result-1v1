import axios from 'axios'

const baseUrl = import.meta.env.VITE_BACKEND

const getEvents = (year="") => {
    const suffix = year ? `?Year=${year}` : ''
    const response = axios.get(`${baseUrl}/tulokset-new/online/online_events_dt.json${suffix}`)
    return response
}

const getEvent = (eventId="2024_esijukola_h") => {
    const response = axios.get(`${baseUrl}/tulokset-new/online/online_${eventId}_event.json`)
    return response
}

const getCompetitors = (eventId="2024_esijukola_h") => {
    const response = axios.get(`${baseUrl}/tulokset-new/online/online_${eventId}_competitors.json`)
    return response
}

const getResults = (eventId="2024_esijukola_h") => {
    const response = axios.get(`${baseUrl}/tulokset-new/online/online_${eventId}_results.json`)
    return response
}

const getResultList = (eventId) => {
    const response = axios.get(`${baseUrl}/tulokset-new/online/online_${eventId}_resultlist.json`)
    return response
}

const getCompetitorDetails = (eventId, competitorBib) => {
    const response = axios.get(`${baseUrl}/tulokset-new/online/online_${eventId}_competitor.json?BaseBib=${competitorBib}`)
    return response
}

export default { getEvents, getEvent, getCompetitors, getResults, getResultList, getCompetitorDetails }