import Promise from 'bluebird'
import dateFns from 'date-fns'
import fs from 'fs-extra'
import got from 'got'
import matter from 'gray-matter'
import { filter, map } from 'lodash'
import path from 'path'
import TurndownService from 'turndown'
import url from 'url'
import convert, { ElementCompact } from 'xml-js'

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
    let text = turndownService.turndown(post['content:encoded']._cdata)
    const title = decodeURI(post['wp:post_name']._cdata || post.title._text)
    const directory = path.join(postsPath, `${dateFns.format(date, 'YYYY-MM-DD')}-${title}`)

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
          encoding: 'binary',
        })
        await fs.outputFile(path.join(directory, filename), resp.body, 'binary')
      } catch (e) {
        console.error(files[filename], e)
      }
    })

    const content = matter.stringify(text, {
      draft: post['wp:status']._cdata === 'draft',
      post_id: parseInt(post['wp:post_id']._text, 10),
      publish_date: dateFns.format(date),
      revise_date: dateFns.format(date),
      tags: map(ensureArray(post.category), '_cdata'),
      title: post.title._text,
    })

    await fs.writeFile(path.join(directory, 'index.md'), content)
  })
}

main()
