/** ProTable 列定义（01 §5：所有列表页禁止手搓 el-table+分页，一律经此封装） */
export interface ProTableColumn {
  /** 行数据字段名（同时也是默认单元格 slot 名） */
  prop: string
  label: string
  width?: number | string
  minWidth?: number | string
  align?: 'left' | 'center' | 'right'
  fixed?: 'left' | 'right'
  /** 自定义单元格渲染 slot 名（缺省 = prop；列模板内拿 { row }） */
  slot?: string
  showOverflowTooltip?: boolean
}

/** 列表请求参数（与后端 PageData 契约直通——01 §5 分页参数不做映射） */
export interface ProTableFetcherParams {
  page: number
  page_size: number
  [key: string]: unknown
}

/** fetcher 返回（offset 分页——zhuzhao 全域；cursor 为 al 域另行适配） */
export interface ProTableResult<Row = unknown> {
  list: Row[]
  total: number
}

export type ProTableFetcher = (
  params: ProTableFetcherParams,
) => Promise<ProTableResult>
