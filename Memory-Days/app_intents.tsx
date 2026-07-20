import { AppIntentManager, AppIntentProtocol, Widget } from 'scripting'
import { loadAppData, saveAppData } from './storage'

export const ToggleCountdownFormatIntent = AppIntentManager.register({
  name: 'ToggleCountdownFormatIntent',
  protocol: AppIntentProtocol.AppIntent,
  perform: async (eventId: string) => {
    const data = await loadAppData()
    const events = data.events.map(event =>
      event.id === eventId
        ? { ...event, showYearsAndDays: !event.showYearsAndDays }
        : event
    )
    await saveAppData({ ...data, events })
    Widget.reloadAll()
  }
})
