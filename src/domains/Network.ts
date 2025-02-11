import {
  trim,
  each,
  decodeUriComponent,
  rmCookie,
  once,
  isNative,
  contain,
} from 'licia-es'
import { XhrRequest, FetchRequest } from '../lib/request'
import connector from '../lib/connector'

export function deleteCookies(params: any) {
  rmCookie(params.name)
}

export function getCookies() {
  const cookies: any[] = []

  const cookie = document.cookie
  if (trim(cookie) !== '') {
    each(cookie.split(';'), function (value: any) {
      value = value.split('=')
      const name = trim(value.shift())
      value = decodeUriComponent(value.join('='))
      cookies.push({
        name,
        value,
      })
    })
  }

  return { cookies }
}

const resTxtMap = new Map()

export const enable = once(function () {
  const winXhrProto = window.XMLHttpRequest.prototype

  const origSend: any = winXhrProto.send
  const origOpen: any = winXhrProto.open
  const origSetRequestHeader: any = winXhrProto.setRequestHeader

  winXhrProto.open = function (method: string, url: string) {
    if (!isValidUrl(url)) {
      return origOpen.apply(this, arguments)
    }

    const xhr = this

    const req = ((xhr as any).chobitsuRequest = new XhrRequest(
      xhr,
      method,
      url
    ))

    req.on('send', (id: string, data: any) => {
      const request: any = {
        method: data.method,
        url: data.url,
        headers: data.reqHeaders,
      }
      if (data.data) {
        request.postData = data.data
      }

      connector.trigger('Network.requestWillBeSent', {
        requestId: id,
        type: 'XHR',
        request,
        timestamp: data.time / 1000,
      })
    })
    req.on('headersReceived', (id: string, data: any) => {
      connector.trigger('Network.responseReceivedExtraInfo', {
        requestId: id,
        blockedCookies: [],
        headers: data.resHeaders,
      })
    })
    req.on('done', (id: string, data: any) => {
      connector.trigger('Network.responseReceived', {
        requestId: id,
        type: 'XHR',
        response: {
          status: data.status,
        },
        timestamp: data.time / 1000,
      })
      resTxtMap.set(id, data.resTxt)
      connector.trigger('Network.loadingFinished', {
        requestId: id,
        encodedDataLength: data.size,
        timestamp: data.time / 1000,
      })
    })

    xhr.addEventListener('readystatechange', function () {
      switch (xhr.readyState) {
        case 2:
          return req.handleHeadersReceived()
        case 4:
          return req.handleDone()
      }
    })

    origOpen.apply(this, arguments)
  }

  winXhrProto.send = function (data) {
    const req = (this as any).chobitsuRequest
    if (req) req.handleSend(data)

    origSend.apply(this, arguments)
  }

  winXhrProto.setRequestHeader = function (key, val) {
    const req = (this as any).chobitsuRequest
    if (req) {
      req.handleReqHeadersSet(key, val)
    }

    origSetRequestHeader.apply(this, arguments)
  }

  let isFetchSupported = false
  if (window.fetch) {
    isFetchSupported = isNative(window.fetch)
  }
  // #2 Probably not a fetch polyfill
  if (!isFetchSupported && navigator.serviceWorker) {
    isFetchSupported = true
  }
  if (!isFetchSupported) return

  const origFetch = window.fetch

  window.fetch = function (...args) {
    const req = new FetchRequest(...args)
    req.on('send', (id, data) => {
      const request: any = {
        method: data.method,
        url: data.url,
        headers: data.reqHeaders,
      }

      if (data.data) {
        request.postData = data.data
      }

      connector.trigger('Network.requestWillBeSent', {
        requestId: id,
        type: 'Fetch',
        request,
        timestamp: data.time / 1000,
      })
    })
    req.on('done', (id, data) => {
      connector.trigger('Network.responseReceived', {
        requestId: id,
        type: 'Fetch',
        response: {
          status: data.status,
          headers: data.resHeaders,
        },
        timestamp: data.time / 1000,
      })
      resTxtMap.set(id, data.resTxt)
      connector.trigger('Network.loadingFinished', {
        requestId: id,
        encodedDataLength: data.size,
        timestamp: data.time / 1000,
      })
    })

    const fetchResult = origFetch(...args)
    req.send(fetchResult)

    return fetchResult
  }
})

export function getResponseBody(params: any) {
  return {
    base64Encoded: false,
    body: resTxtMap.get(params.requestId),
  }
}

function isValidUrl(url: string) {
  return !contain(url, '__chobitsu-hide__=true')
}
