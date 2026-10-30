// Practice texts. Only letters, spaces and . , ' so that every character can
// be typed with plain keys plus a home-row Shift. Each session draws shuffled
// sentences until it reaches the target length.
window.CORPUS = {
  prose: {
    name: "Prose",
    sentences: [
      "Anna and Sam drove past the harbour as the rain began.",
      "Patrick asked whether the last train to Malmo was late again.",
      "A small cafe near the square sells bread, jam and black tea.",
      "Lisa said that Paris in April is a fair bit warmer than Oslo.",
      "The team in Madrid had a plan, a map and a lot of patience.",
      "Martin parked the van at the back and carried the bags inside.",
      "Each draft has a date, a name and a short abstract at the start.",
      "Hannah wants a quiet afternoon away from the noise of the city.",
      "Tomas packed a jacket, a hat and a flask of warm water.",
      "Sara played a calm jazz track while the pasta was baking.",
      "We can always ask Daniel, as he has a habit of knowing such things.",
      "Grandma made pancakes and apple sauce for the whole family.",
      "The data says that average traffic falls sharply after August.",
      "Karin had a bad day, so she sat alone and read a magazine.",
      "Alex and Jonas came back from Japan with a bag of strange snacks.",
      "That fast black cat ran past a startled man at the gate.",
      "Laura has a passion for maps, atlases and old travel diaries.",
      "Rasmus said that Stockholm in autumn has a calm, grey beauty.",
    ],
  },
  rolls: {
    name: "Rolls and capitals drill",
    sentences: [
      "as as as and an at aside ask Asa has saw salt last fast past",
      "Ada asked Sam about the Alaska map at Jasper Bay.",
      "sad salads, small sails, tasks and casks, flasks and masks",
      "Kim Lund and Dan Sand saw Nils and Mats at Hasselby.",
      "What a nasty, sassy, classy alpaca that was.",
      "Hans, Lars, Olaf and Kasper had a sauna at Aspas.",
      "Saturday was a hard day as Anders had a sad Jaguar.",
      "past pasta pastel pasture pass passage passenger passive",
      "Ask Tara what Sandra asked Nadia at the Alhambra.",
      "Jakob, Klas and Linda walked as far as Saltsjobaden.",
    ],
  },
  camel: {
    name: "camelCase",
    sentences: [
      "getUserName setItemCount parseJsonBody isValidDate hasAccess",
      "loadAllAssets mapToArray readFileAsync sendBatchRequest",
      "toUpperCase addEventListener removeChild appendChild",
      "maxRetryCount defaultTimeout baseApiUrl lastSavedAt",
      "useState useEffect useMemo useCallback useLayoutEffect",
      "fetchPageData handleSubmit onKeyDown onMouseMove",
      "createdAt updatedAt deletedAt startedAt finishedAt",
      "isLoading hasError canEdit shouldRender wasAborted",
    ],
  },
  svenska: {
    name: "Svenska (svensk layout, ö på ;)",
    sentences: [
      "Anna och Sara åkte tåg från Malmö till Göteborg i lördags.",
      "Det är en bra dag för att baka bullar och dricka kaffe.",
      "Lars köpte smör, ost och bröd på torget i Västerås.",
      "Höstens första frost lade sig över ängarna vid sjön.",
      "Maja har en katt som heter Sigge och älskar att sova.",
      "Vi måste hinna till Stockholm innan klockan fem.",
      "Barnen badade i havet hela dagen och åt glass på kvällen.",
      "Göran säger att Skåne har de bästa äpplena i landet.",
    ],
  },
};
