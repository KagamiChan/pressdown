import Promise from 'bluebird'
import fs from 'fs-extra'
import convert, { ElementCompact } from 'xml-js'

interface ITextType {
  _text: string
}

interface ICDataType {
  _cdata: string
}

interface IWordpressPost {
  title: ITextType
  'wp:post_date': ICDataType
  'content:encoded': ICDataType
  'wp:post_type': ICDataType
  'wp:status': ICDataType
}

interface IWordpressDataCompact extends ElementCompact {
  rss: {
    channel: {
      item: []
    }
  }
}

const main = async () => {
  const xml = await fs.readFile(process.argv[2])

  const data = convert.xml2js(xml.toString(), { compact: true }) as IWordpressDataCompact
}

main()
