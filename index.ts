import Promise from 'bluebird'
import dateFns from 'date-fns'
import fs from 'fs-extra'
import got from 'got'
import matter from 'gray-matter'
import HttpsProxyAgent from 'https-proxy-agent'
import { filter, map } from 'lodash'
import path from 'path'
import prettier from 'prettier'
import TurndownService from 'turndown'
import url from 'url'
import convert, { ElementCompact } from 'xml-js'

const proxy = process.env.https_proxy || process.env.http_proxy
const httpsAgent = proxy ? new HttpsProxyAgent(proxy) : undefined

interface ITextType {
  _attributes?: {
    [key: string]: string
  }
  _text: string
}

interface ICDataType {
  _attributes?: {
    [key: string]: string
  }
  _cdata: string
}

interface IWordpressPost {
  title: ITextType
  'wp:post_date': ICDataType
  'content:encoded': ICDataType
  'wp:post_type': ICDataType
  'wp:status': ICDataType
  'wp:post_name': ICDataType
  category: ICDataType | ICDataType[]
  'wp:post_id': ITextType
}

interface IWordpressDataCompact extends ElementCompact {
  rss: {
    channel: {
      item: IWordpressPost[]
    }
  }
}

const ensureArray = <T = any>(input: T | T[]): T[] => (Array.isArray(input) ? input : [input])

const turndownService = new TurndownService()
const markdownImgaeRegex = /(?:!\[(.*?)\]\((.*?)\))/gm

const format = (text: string) =>
  prettier.format(
    text
      .replace(/“(.+?)”/g, (match: string, p1: string) => `「${p1}」`)
      .replace(/”(.+?)“/g, (match: string, p1: string) => `「${p1}」`)
      .replace(/‘(.+?)’/g, (match: string, p1: string) => `『${p1}』`)
      .replace(/’(.+?)‘/g, (match: string, p1: string) => `『${p1}』`),
    {
      parser: 'markdown',
      printWidth: 120,
      semi: false,
      singleQuote: true,
      trailingComma: 'all',
    },
  )

const main = async () => {
  const xml = await fs.readFile(process.argv[2])

  const data = convert.xml2js(xml.toString(), { compact: true }) as IWordpressDataCompact

  const posts: IWordpressPost[] = filter(
    data.rss.channel.item,
    (item: IWordpressPost) => item['wp:post_type']._cdata === 'post' && Boolean(item['content:encoded']._cdata),
  )

  const postsPath = path.resolve(__dirname, 'posts')

  await Promise.map(posts, async (post: IWordpressPost) => {
    const date = dateFns.parse(post['wp:post_date']._cdata)

    let html = post['content:encoded']._cdata

    html = html.replace(/\n+/g, '<br />')

    let text = turndownService.turndown(html)
    const title = decodeURI(post['wp:post_name']._cdata || post.title._text)
    const directory = path.join(postsPath, `${dateFns.format(date, 'YYYY-MM-DD')}-${format(title)}`)

    await fs.ensureDir(directory)

    const files: { [key: string]: string } = {}

    text = text.replace(markdownImgaeRegex, (match: string, p1: string, p2: string) => {
      const uri = p2.split(' ')[0]
      const parsed = url.parse(uri)
      const filename = path.basename(parsed.pathname || '')
      if (!filename) {
        return match
      }
      files[filename] = uri
      return match.replace(p2, filename)
    })

    await Promise.map(Object.keys(files), async filename => {
      try {
        const resp = await got(files[filename], {
          agent: httpsAgent,
          encoding: 'binary',
        })
        await fs.outputFile(path.join(directory, filename), resp.body, 'binary')
      } catch (e) {
        console.error(files[filename], e)
      }
    })

    const content = matter.stringify(format(text), {
      draft: post['wp:status']._cdata === 'draft',
      post_id: parseInt(post['wp:post_id']._text, 10),
      publish_date: dateFns.format(date),
      revise_date: dateFns.format(date),
      tags: map(ensureArray(post.category), '_cdata'),
      title: format(post.title._text),
    })

    await fs.writeFile(path.join(directory, 'index.md'), content)
  })
}

main()
